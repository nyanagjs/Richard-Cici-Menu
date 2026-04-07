// ===== Firebase Config (replace REPLACE_ME values with your Firebase project config) =====
const firebaseConfig = {
  apiKey: "AIzaSyDv3w4UzW4kVNaFuFSinQC8CHa4xyUpClo",
  authDomain: "rnc-menu.firebaseapp.com",
  projectId: "rnc-menu",
  storageBucket: "rnc-menu.firebasestorage.app",
  messagingSenderId: "690457296098",
  appId: "1:690457296098:web:1442a9e0abb03cfb0b32bb"
};

let db = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch (e) {
  // Firebase not available (e.g. file:// without SDK) — falls back to localStorage only
}

function saveDishToFirestore(dish) {
  if (!db || dish === undefined) return;
  db.collection('dishes').doc(dish.id).set(dish).catch(() => {});
}

function deleteDishFromFirestore(id) {
  if (!db) return;
  db.collection('dishes').doc(id).delete().catch(() => {});
}

function savePantryToFirestore() {
  if (!db) return;
  db.collection('app_data').doc('pantry').set({
    ingredients: pantryIngredients,
    seasonings: pantrySeasonings,
  }).catch(() => {});
}

// ===== Vision Worker URL =====
// After creating your Cloudflare Worker, replace the placeholder below with your Worker URL.
const VISION_WORKER_URL = 'https://rnc-menu-vision.nyanagjs.workers.dev';

// ===== Storage Helpers =====
const KEYS = {
  dishes: 'rcm_dishes',
  pantryIngredients: 'rcm_pantry_ingredients',
  pantrySeasonings: 'rcm_pantry_seasonings',
  groupBy: 'rcm_group_by',
  shoppingSelections: 'rcm_shopping_selections',
  shoppingChecked: 'rcm_shopping_checked',
};

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ===== Unit System =====
const UNITS = {
  'g':    { type: 'weight', factor: 1 },
  'kg':   { type: 'weight', factor: 1000 },
  'oz':   { type: 'weight', factor: 28.35 },
  'lb':   { type: 'weight', factor: 453.6 },
  'ml':   { type: 'volume', factor: 1 },
  'L':    { type: 'volume', factor: 1000 },
  'tsp':  { type: 'volume', factor: 5 },
  'tbsp': { type: 'volume', factor: 15 },
  '勺':   { type: 'volume', factor: 15 },
  'cup':  { type: 'volume', factor: 240 },
  '个':   { type: 'count', factor: 1 },
  '只':   { type: 'count', factor: 1 },
  '片':   { type: 'count', factor: 1 },
  '颗':   { type: 'count', factor: 1 },
  '条':   { type: 'count', factor: 1 },
  '块':   { type: 'count', factor: 1 },
  '适量': { type: 'taste', factor: null },
};

function autoConvert(value, unit) {
  if (unit === 'g' && value >= 1000) return { value: +(value / 1000).toFixed(3), unit: 'kg' };
  if (unit === 'kg' && value < 0.1)  return { value: +(value * 1000).toFixed(1), unit: 'g' };
  if (unit === 'ml' && value >= 1000) return { value: +(value / 1000).toFixed(3), unit: 'L' };
  if (unit === 'L' && value < 0.1)   return { value: +(value * 1000).toFixed(1), unit: 'ml' };
  return { value, unit };
}

function scaleAmount(item, ratio) {
  if (item.unit === '适量' || item.value === null || item.value === undefined) {
    return { value: null, unit: item.unit || '适量' };
  }
  const scaled = item.value * ratio;
  const rounded = Math.round(scaled * 100) / 100;
  return autoConvert(rounded, item.unit);
}

function formatAmount(value, unit) {
  if (unit === '适量' || value === null || value === undefined) return '适量';
  const display = Number.isInteger(value) ? value : parseFloat(value.toFixed(2));
  return `${display} ${unit}`;
}

// ===== Data Migration (old format: { name, amount: "500g" } → { name, value, unit }) =====
function parseOldAmount(amountStr) {
  if (!amountStr) return { value: null, unit: '适量' };
  if (amountStr === '适量') return { value: null, unit: '适量' };
  const match = String(amountStr).match(/^([\d.]+)\s*(.*)$/);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2].trim() || 'g';
    return { value: isNaN(val) ? null : val, unit: UNITS[unit] ? unit : 'g' };
  }
  return { value: null, unit: '适量' };
}

function migrateItems(items) {
  return (items || []).map(item => {
    if (item.value !== undefined) return item; // already new format
    const parsed = parseOldAmount(item.amount);
    return { name: item.name, value: parsed.value, unit: parsed.unit };
  });
}

const MERGE_MAIN_INGREDIENT = { '鱼': '海鲜', '虾': '海鲜' };

function migrateDishes(raw) {
  return raw.map(d => {
    const mi = d.mainIngredient || '';
    return {
      ...d,
      mainIngredient: MERGE_MAIN_INGREDIENT[mi] ?? mi,
      baseServings: d.baseServings || 2,
      photo: d.photo || null,
      ingredients: migrateItems(d.ingredients),
      seasonings: migrateItems(d.seasonings),
      keySpices: migrateItems(d.keySpices),
      auxSpices: migrateItems(d.auxSpices),
      steps: d.steps || [],
    };
  });
}

// ===== State =====
let dishes = migrateDishes(load(KEYS.dishes));
let pantryIngredients = load(KEYS.pantryIngredients);
let pantrySeasonings = load(KEYS.pantrySeasonings);
let groupBy = localStorage.getItem(KEYS.groupBy) || 'ingredient'; // 'ingredient' | 'category'
let searchQuery = '';

// Shopping state
let shoppingSelections = load(KEYS.shoppingSelections) || {};
let shoppingChecked = new Set(load(KEYS.shoppingChecked) || []);

// Modal state
let editingDishId = null;
let modalIngredients = [];
let modalSeasonings = [];
let modalKeySpices = [];
let modalAuxSpices = [];
let modalPhoto = null;
let modalSteps = [];

// ===== View Mode =====
const IS_VIEW_MODE = new URLSearchParams(window.location.search).has('view');
let currentTab = 'menu';

if (IS_VIEW_MODE) {
  document.body.classList.add('view-mode');
  document.getElementById('view-mode-banner').classList.remove('hidden');
}

// ===== Tab Navigation =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'recommend') renderRecommend();
    if (tab === 'shopping') renderShopping();
  });
});

// ===== Group Toggle =====
document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    groupBy = btn.dataset.group;
    localStorage.setItem(KEYS.groupBy, groupBy);
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderDishes();
  });
});

// Set initial toggle state
document.querySelector(`[data-group="${groupBy}"]`)?.classList.add('active');
document.querySelectorAll('.toggle-btn').forEach(b => {
  if (b.dataset.group !== groupBy) b.classList.remove('active');
});

// ===== Search =====
function onSearchInput() {
  searchQuery = document.getElementById('dish-search').value.trim().toLowerCase();
  renderDishes();
}

// ===== Render Dish List =====
function renderDishes() {
  const container = document.getElementById('dish-list');

  const filteredDishes = searchQuery
    ? dishes.filter(d => {
        const q = searchQuery;
        return d.name.toLowerCase().includes(q)
          || (d.mainIngredient || '').toLowerCase().includes(q)
          || d.ingredients.some(i => i.name.toLowerCase().includes(q))
          || d.seasonings.some(i => i.name.toLowerCase().includes(q));
      })
    : dishes;

  if (dishes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🍳</div>
        <p>还没有菜谱，点击「添加菜」开始吧！<br>No recipes yet. Click "添加菜" to start!</p>
      </div>`;
    return;
  }

  if (filteredDishes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🔍</div>
        <p>没有找到「${escHtml(searchQuery)}」相关的菜谱</p>
      </div>`;
    return;
  }

  if (groupBy === 'ingredient') {
    renderGrouped(container, filteredDishes, d => d.mainIngredient || '其他', '🥩 ');
  } else {
    const catLabels = {
      '主菜': '主菜 Main Dish', '汤': '汤 Soup',
      '小菜': '小菜 Side Dish', '主食': '主食 Staple', '甜点': '甜点 Dessert',
    };
    renderGrouped(container, filteredDishes, d => d.category || '其他', '', catLabels);
  }
}

function renderGrouped(container, data, keyFn, prefix, labelMap = {}) {
  const groups = {};
  data.forEach(d => {
    const key = keyFn(d);
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === '其他') return 1;
    if (b === '其他') return -1;
    return a.localeCompare(b, 'zh');
  });

  container.innerHTML = sortedKeys.map(key => `
    <div class="category-group">
      <div class="category-label">${prefix}${labelMap[key] || key}</div>
      ${groups[key].map(dish => dishCardHtml(dish)).join('')}
    </div>`).join('');
}

function dishCardHtml(dish) {
  const thumbHtml = dish.photo
    ? `<img class="dish-thumb" src="${dish.photo}" alt="${escHtml(dish.name)}" />`
    : `<div class="dish-thumb-placeholder">🍽️</div>`;

  const mainTag = dish.mainIngredient
    ? `<span class="tag main">${escHtml(dish.mainIngredient)}</span>`
    : '';

  return `
    <div class="dish-card">
      ${thumbHtml}
      <div class="dish-info">
        <div class="dish-name">${escHtml(dish.name)}</div>
        <div class="dish-meta">${dish.baseServings || 2} 人份基准</div>
        <div class="dish-tags">
          ${mainTag}
          ${dish.ingredients.slice(0, 4).map(i => `<span class="tag ingredient">${escHtml(i.name)}</span>`).join('')}
          ${dish.ingredients.length > 4 ? `<span class="tag">+${dish.ingredients.length - 4}</span>` : ''}
        </div>
      </div>
      <div class="dish-actions">
        <button class="btn-icon" title="查看" onclick="viewDish('${dish.id}')">👁️</button>
        <button class="btn-icon" title="编辑" onclick="editDish('${dish.id}')">✏️</button>
        <button class="btn-icon" title="删除" onclick="deleteDish('${dish.id}')">🗑️</button>
      </div>
    </div>`;
}

// ===== Photo Handling =====
const photoUploadArea = document.getElementById('photo-upload-area');
const photoInput = document.getElementById('photo-input');
const photoPreview = document.getElementById('photo-preview');
const photoPlaceholder = document.getElementById('photo-placeholder');
const btnRemovePhoto = document.getElementById('btn-remove-photo');

photoUploadArea.addEventListener('click', e => {
  if (e.target === btnRemovePhoto) return;
  if (e.target.id === 'btn-recognize') return;
  photoInput.click();
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) return;
  modalPhoto = await compressImage(file);
  photoPreview.src = modalPhoto;
  photoPreview.classList.remove('hidden');
  photoPlaceholder.style.display = 'none';
  btnRemovePhoto.classList.remove('hidden');
  document.getElementById('btn-recognize').classList.remove('hidden');
  photoInput.value = '';
});

btnRemovePhoto.addEventListener('click', e => {
  e.stopPropagation();
  modalPhoto = null;
  photoPreview.src = '';
  photoPreview.classList.add('hidden');
  photoPlaceholder.style.display = '';
  btnRemovePhoto.classList.add('hidden');
  document.getElementById('btn-recognize').classList.add('hidden');
  document.getElementById('recognize-loading').classList.add('hidden');
});

function compressImage(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = url;
  });
}

// ===== AI Dish Recognition =====
async function recognizeDish() {
  if (!modalPhoto) return;
  if (!VISION_WORKER_URL || VISION_WORKER_URL === 'YOUR_WORKER_URL') {
    alert('请先在 app.js 中设置 VISION_WORKER_URL（Cloudflare Worker 地址）');
    return;
  }

  const btn = document.getElementById('btn-recognize');
  const loading = document.getElementById('recognize-loading');
  btn.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const [header, base64Data] = modalPhoto.split(',');
    const mediaType = header.match(/data:([^;]+)/)[1];

    const resp = await fetch(VISION_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mediaType }),
    });

    if (!resp.ok) throw new Error(`服务器错误 ${resp.status}`);

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || '识别失败');

    const rawText = data.content?.[0]?.text || '';
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) throw new Error('无法解析识别结果，请重试');

    const result = JSON.parse(jsonMatch[1]);

    // Fill name only if currently empty
    const nameEl = document.getElementById('dish-name');
    if (result.name && !nameEl.value.trim()) {
      nameEl.value = result.name;
    }

    // Set main ingredient if the value matches a valid option
    if (result.mainIngredient) {
      const sel = document.getElementById('dish-main-ingredient');
      const matched = [...sel.options].find(o => o.value === result.mainIngredient);
      if (matched) sel.value = result.mainIngredient;
    }

    // Append ingredients (don't clear existing)
    if (Array.isArray(result.ingredients) && result.ingredients.length) {
      result.ingredients.forEach(item => {
        if (item.name) modalIngredients.push({
          name: item.name,
          value: item.value ?? null,
          unit: item.unit || 'g',
        });
      });
      renderModalItems();
    }

    // Append seasonings
    if (Array.isArray(result.seasonings) && result.seasonings.length) {
      result.seasonings.forEach(item => {
        if (item.name) modalSeasonings.push({
          name: item.name,
          value: item.value ?? null,
          unit: item.unit || '适量',
        });
      });
      renderModalItems();
    }

  } catch (e) {
    alert('识别失败：' + e.message);
  } finally {
    loading.classList.add('hidden');
    btn.classList.remove('hidden');
  }
}

// ===== Add/Edit Dish Modal =====
document.getElementById('btn-add-dish').addEventListener('click', () => openModal());
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// Servings +/- in modal
document.getElementById('modal-servings-minus').addEventListener('click', () => {
  const el = document.getElementById('dish-base-servings');
  if (+el.value > 1) el.value = +el.value - 1;
});
document.getElementById('modal-servings-plus').addEventListener('click', () => {
  const el = document.getElementById('dish-base-servings');
  el.value = +el.value + 1;
});

function openModal(dish = null) {
  editingDishId = dish ? dish.id : null;
  modalIngredients = dish ? dish.ingredients.map(i => ({...i})) : [];
  modalSeasonings = dish ? dish.seasonings.map(s => ({...s})) : [];
  modalKeySpices = dish ? (dish.keySpices || []).map(i => ({...i})) : [];
  modalAuxSpices = dish ? (dish.auxSpices || []).map(i => ({...i})) : [];
  modalPhoto = dish ? dish.photo : null;
  modalSteps = dish ? (dish.steps || []).map(s => ({...s})) : [];

  document.getElementById('modal-title').textContent = dish ? '编辑菜 Edit Dish' : '添加菜 Add Dish';
  document.getElementById('dish-name').value = dish ? dish.name : '';
  document.getElementById('dish-main-ingredient').value = dish ? (dish.mainIngredient || '') : '';
  document.getElementById('dish-category').value = dish ? dish.category : '主菜';
  document.getElementById('dish-base-servings').value = dish ? (dish.baseServings || 2) : 2;

  // Photo
  if (modalPhoto) {
    photoPreview.src = modalPhoto;
    photoPreview.classList.remove('hidden');
    photoPlaceholder.style.display = 'none';
    btnRemovePhoto.classList.remove('hidden');
    document.getElementById('btn-recognize').classList.remove('hidden');
  } else {
    photoPreview.src = '';
    photoPreview.classList.add('hidden');
    photoPlaceholder.style.display = '';
    btnRemovePhoto.classList.add('hidden');
    document.getElementById('btn-recognize').classList.add('hidden');
  }
  document.getElementById('recognize-loading').classList.add('hidden');

  // Clear add-item inputs
  ['input-ingredient-name', 'input-ingredient-value', 'input-seasoning-name', 'input-seasoning-value', 'input-key-spice-name', 'input-key-spice-value', 'input-aux-spice-name', 'input-aux-spice-value', 'input-step-text'].forEach(id => {
    document.getElementById(id).value = '';
  });

  renderModalItems();
  renderModalSpices();
  renderModalSteps();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('dish-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

const UNIT_OPTIONS = ['g','kg','ml','L','tbsp','tsp','勺','cup','个','只','片','颗','条','块','oz','lb','适量'];

function unitSelectHtml(selectedUnit) {
  return `<select class="unit-select" style="max-width:60px">
    ${UNIT_OPTIONS.map(u => `<option value="${u}"${u === selectedUnit ? ' selected' : ''}>${u}</option>`).join('')}
  </select>`;
}

function editableItemRowHtml(type, item, i) {
  const isAdaptive = item.unit === '适量';
  return `
    <div class="ing-edit-row">
      <input type="text" class="ing-edit-name" value="${escHtml(item.name)}"
        placeholder="名称" oninput="updateModalItem('${type}',${i},'name',this.value)" />
      <div class="ing-edit-bottom">
        <input type="number" class="ing-edit-value" value="${isAdaptive || item.value === null ? '' : item.value}"
          placeholder="用量" min="0" step="any" inputmode="decimal" ${isAdaptive ? 'disabled' : ''}
          oninput="updateModalItem('${type}',${i},'value',this.value)" />
        <select class="ing-edit-unit"
          onchange="updateModalItem('${type}',${i},'unit',this.value)">
          ${UNIT_OPTIONS.map(u => `<option value="${u}"${u === item.unit ? ' selected' : ''}>${u}</option>`).join('')}
        </select>
        <button class="remove-btn" onclick="removeModalItem('${type}',${i})">✕</button>
      </div>
    </div>`;
}

function renderModalItems() {
  const ingList = document.getElementById('ingredients-list');
  const seaList = document.getElementById('seasonings-list');

  ingList.innerHTML = modalIngredients.map((item, i) =>
    editableItemRowHtml('ingredient', item, i)
  ).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无食材</div>';

  seaList.innerHTML = modalSeasonings.map((item, i) =>
    editableItemRowHtml('seasoning', item, i)
  ).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无调味料</div>';
}

function getModalArr(type) {
  if (type === 'ingredient') return modalIngredients;
  if (type === 'seasoning')  return modalSeasonings;
  if (type === 'keySpice')   return modalKeySpices;
  if (type === 'auxSpice')   return modalAuxSpices;
}

function updateModalItem(type, index, field, rawValue) {
  const arr = getModalArr(type);
  if (field === 'name') {
    arr[index].name = rawValue;
  } else if (field === 'value') {
    arr[index].value = rawValue === '' ? null : parseFloat(rawValue);
  } else if (field === 'unit') {
    arr[index].unit = rawValue;
    if (rawValue === '适量') arr[index].value = null;
    if (type === 'keySpice' || type === 'auxSpice') renderModalSpices();
    else renderModalItems();
  }
}

function removeModalItem(type, index) {
  getModalArr(type).splice(index, 1);
  if (type === 'keySpice' || type === 'auxSpice') renderModalSpices();
  else renderModalItems();
}

function renderModalSpices() {
  const keyList = document.getElementById('key-spices-list');
  const auxList = document.getElementById('aux-spices-list');
  keyList.innerHTML = modalKeySpices.map((item, i) =>
    editableItemRowHtml('keySpice', item, i)
  ).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无关键香料</div>';
  auxList.innerHTML = modalAuxSpices.map((item, i) =>
    editableItemRowHtml('auxSpice', item, i)
  ).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无辅助香料</div>';
}

function renderModalSteps() {
  const list = document.getElementById('steps-list');
  list.innerHTML = modalSteps.map((s, i) => `
    <div class="step-edit-row">
      <span class="step-order">${i + 1}</span>
      <input type="text" class="step-edit-input" value="${escHtml(s.text)}" placeholder="步骤说明"
        oninput="updateModalStep(${i}, this.value)" />
      <button class="remove-btn" onclick="removeModalStep(${i})">✕</button>
    </div>`).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无步骤</div>';
}

function updateModalStep(index, value) {
  modalSteps[index].text = value;
}

function removeModalStep(index) {
  modalSteps.splice(index, 1);
  renderModalSteps();
}

document.getElementById('btn-add-ingredient-item').addEventListener('click', () => {
  const name = document.getElementById('input-ingredient-name').value.trim();
  const valStr = document.getElementById('input-ingredient-value').value.trim();
  const unit = document.getElementById('input-ingredient-unit').value;
  if (!name) return;
  const value = unit === '适量' ? null : (valStr ? parseFloat(valStr) : null);
  modalIngredients.push({ name, value, unit });
  document.getElementById('input-ingredient-name').value = '';
  document.getElementById('input-ingredient-value').value = '';
  renderModalItems();
  document.getElementById('input-ingredient-name').focus();
});

document.getElementById('btn-add-seasoning-item').addEventListener('click', () => {
  const name = document.getElementById('input-seasoning-name').value.trim();
  const valStr = document.getElementById('input-seasoning-value').value.trim();
  const unit = document.getElementById('input-seasoning-unit').value;
  if (!name) return;
  const value = unit === '适量' ? null : (valStr ? parseFloat(valStr) : null);
  modalSeasonings.push({ name, value, unit });
  document.getElementById('input-seasoning-name').value = '';
  document.getElementById('input-seasoning-value').value = '';
  renderModalItems();
  document.getElementById('input-seasoning-name').focus();
});

// Enter shortcuts
document.getElementById('input-ingredient-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-ingredient-item').click();
});
document.getElementById('input-seasoning-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-seasoning-item').click();
});

document.getElementById('btn-add-step').addEventListener('click', () => {
  const text = document.getElementById('input-step-text').value.trim();
  if (!text) return;
  modalSteps.push({ order: modalSteps.length + 1, text });
  document.getElementById('input-step-text').value = '';
  renderModalSteps();
  document.getElementById('input-step-text').focus();
});
document.getElementById('input-step-text').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-step').click();
});

// Auto-hide value input when "适量" is selected
document.getElementById('input-ingredient-unit').addEventListener('change', function() {
  document.getElementById('input-ingredient-value').disabled = this.value === '适量';
});
document.getElementById('input-seasoning-unit').addEventListener('change', function() {
  document.getElementById('input-seasoning-value').disabled = this.value === '适量';
});

// Spice add buttons
function addSpiceItem(type, nameId, valueId, unitId) {
  const name = document.getElementById(nameId).value.trim();
  const valStr = document.getElementById(valueId).value.trim();
  const unit = document.getElementById(unitId).value;
  if (!name) return;
  const value = unit === '适量' ? null : (valStr ? parseFloat(valStr) : null);
  getModalArr(type).push({ name, value, unit });
  document.getElementById(nameId).value = '';
  document.getElementById(valueId).value = '';
  renderModalSpices();
  document.getElementById(nameId).focus();
}
document.getElementById('btn-add-key-spice').addEventListener('click', () =>
  addSpiceItem('keySpice', 'input-key-spice-name', 'input-key-spice-value', 'input-key-spice-unit'));
document.getElementById('btn-add-aux-spice').addEventListener('click', () =>
  addSpiceItem('auxSpice', 'input-aux-spice-name', 'input-aux-spice-value', 'input-aux-spice-unit'));
document.getElementById('input-key-spice-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-key-spice').click();
});
document.getElementById('input-aux-spice-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-aux-spice').click();
});
document.getElementById('input-key-spice-unit').addEventListener('change', function() {
  document.getElementById('input-key-spice-value').disabled = this.value === '适量';
});
document.getElementById('input-aux-spice-unit').addEventListener('change', function() {
  document.getElementById('input-aux-spice-value').disabled = this.value === '适量';
});

document.getElementById('btn-save-dish').addEventListener('click', () => {
  const name = document.getElementById('dish-name').value.trim();
  if (!name) {
    const el = document.getElementById('dish-name');
    el.focus();
    el.style.borderColor = '#E53935';
    setTimeout(() => { el.style.borderColor = ''; }, 1500);
    return;
  }

  const dishData = {
    name,
    mainIngredient: document.getElementById('dish-main-ingredient').value.trim(),
    category: document.getElementById('dish-category').value,
    baseServings: parseInt(document.getElementById('dish-base-servings').value) || 2,
    photo: modalPhoto,
    ingredients: modalIngredients,
    seasonings: modalSeasonings,
    keySpices: modalKeySpices,
    auxSpices: modalAuxSpices,
    steps: modalSteps,
  };

  let savedDish;
  if (editingDishId) {
    const idx = dishes.findIndex(d => d.id === editingDishId);
    if (idx !== -1) {
      dishes[idx] = { ...dishes[idx], ...dishData };
      savedDish = dishes[idx];
    }
  } else {
    savedDish = { id: uid(), ...dishData };
    dishes.push(savedDish);
  }

  save(KEYS.dishes, dishes);
  if (savedDish) saveDishToFirestore(savedDish);
  closeModal();
  renderDishes();
});

// ===== Edit / Delete / View =====
function editDish(id) {
  const dish = dishes.find(d => d.id === id);
  if (dish) openModal(dish);
}

function deleteDish(id) {
  const dish = dishes.find(d => d.id === id);
  if (!dish) return;
  if (!confirm(`确认删除「${dish.name}」？`)) return;
  dishes = dishes.filter(d => d.id !== id);
  save(KEYS.dishes, dishes);
  deleteDishFromFirestore(id);
  renderDishes();
}

let viewingDishId = null;

function viewDish(id) {
  const dish = dishes.find(d => d.id === id);
  if (!dish) return;
  viewingDishId = id;

  document.getElementById('detail-title').textContent = dish.name;

  const detailPhoto = document.getElementById('detail-photo');
  if (dish.photo) {
    detailPhoto.src = dish.photo;
    detailPhoto.classList.remove('hidden');
  } else {
    detailPhoto.src = '';
    detailPhoto.classList.add('hidden');
  }

  const servingsEl = document.getElementById('detail-servings');
  servingsEl.value = dish.baseServings || 2;
  renderDetailContent(dish, dish.baseServings || 2);

  document.getElementById('modal-detail-overlay').classList.remove('hidden');
}

function renderDetailContent(dish, targetServings) {
  const base = dish.baseServings || 2;
  const ratio = targetServings / base;

  const ingHtml = dish.ingredients.length
    ? dish.ingredients.map(i => {
        const scaled = scaleAmount(i, ratio);
        return `<div class="detail-item">
          <span>${escHtml(i.name)}</span>
          <span class="amount">${formatAmount(scaled.value, scaled.unit)}</span>
        </div>`;
      }).join('')
    : '<div style="color:#999;font-size:0.85rem;">暂无</div>';

  const seaHtml = dish.seasonings.length
    ? dish.seasonings.map(s => {
        const scaled = scaleAmount(s, ratio);
        return `<div class="detail-item">
          <span>${escHtml(s.name)}</span>
          <span class="amount">${formatAmount(scaled.value, scaled.unit)}</span>
        </div>`;
      }).join('')
    : '<div style="color:#999;font-size:0.85rem;">暂无</div>';

  const stepsHtml = (dish.steps && dish.steps.length)
    ? dish.steps.map((s, i) => `
        <div class="step-item">
          <span class="step-num">${i + 1}</span>
          <span>${escHtml(s.text)}</span>
        </div>`).join('')
    : '<div style="color:#999;font-size:0.85rem;">暂无步骤</div>';

  function spiceListHtml(arr, emptyText) {
    return arr && arr.length
      ? arr.map(s => {
          const scaled = scaleAmount(s, ratio);
          return `<div class="detail-item">
            <span>${escHtml(s.name)}</span>
            <span class="amount">${formatAmount(scaled.value, scaled.unit)}</span>
          </div>`;
        }).join('')
      : `<div style="color:#999;font-size:0.85rem;">${emptyText}</div>`;
  }

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-section">
      <h4>🥩 食材 Ingredients</h4>
      ${ingHtml}
    </div>
    <div class="detail-section">
      <h4>🧂 调味料 Seasonings</h4>
      ${seaHtml}
    </div>
    <div class="detail-section">
      <h4>🌶️ 关键香料 Key Spices</h4>
      ${spiceListHtml(dish.keySpices, '暂无')}
    </div>
    <div class="detail-section">
      <h4>🌿 辅助香料 Aux Spices</h4>
      ${spiceListHtml(dish.auxSpices, '暂无')}
    </div>
    <div class="detail-section">
      <h4>📋 烹饪步骤 Steps</h4>
      ${stepsHtml}
    </div>`;
}

// Servings +/- in detail
document.getElementById('detail-servings-minus').addEventListener('click', () => {
  const el = document.getElementById('detail-servings');
  if (+el.value > 1) {
    el.value = +el.value - 1;
    updateDetailServings();
  }
});
document.getElementById('detail-servings-plus').addEventListener('click', () => {
  const el = document.getElementById('detail-servings');
  el.value = +el.value + 1;
  updateDetailServings();
});
document.getElementById('detail-servings').addEventListener('change', updateDetailServings);

function updateDetailServings() {
  const dish = dishes.find(d => d.id === viewingDishId);
  if (!dish) return;
  const servings = Math.max(1, parseInt(document.getElementById('detail-servings').value) || 1);
  renderDetailContent(dish, servings);
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('modal-detail-overlay').classList.add('hidden');
});
document.getElementById('modal-detail-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-detail-overlay')) {
    document.getElementById('modal-detail-overlay').classList.add('hidden');
  }
});

// ===== Pantry =====
function renderPantry() {
  renderPantrySection('pantry-ingredients', pantryIngredients, KEYS.pantryIngredients);
  renderPantrySection('pantry-seasonings', pantrySeasonings, KEYS.pantrySeasonings);
}

function renderPantrySection(containerId, items, storageKey) {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    container.innerHTML = '<div style="color:#999;font-size:0.85rem;padding:4px 0;">还没有项目 No items yet</div>';
    return;
  }
  container.innerHTML = items.map((item, i) => `
    <div class="pantry-item ${item.checked ? 'checked' : ''}"
         onclick="togglePantryItem('${storageKey}', ${i})">
      <span class="check-icon">${item.checked ? '✓' : '○'}</span>
      <span>${escHtml(item.name)}</span>
      <button class="delete-btn" onclick="deletePantryItem(event, '${storageKey}', ${i})">✕</button>
    </div>`).join('');
}

function togglePantryItem(storageKey, index) {
  const arr = storageKey === KEYS.pantryIngredients ? pantryIngredients : pantrySeasonings;
  arr[index].checked = !arr[index].checked;
  save(storageKey, arr);
  savePantryToFirestore();
  renderPantry();
}

function deletePantryItem(event, storageKey, index) {
  event.stopPropagation();
  if (storageKey === KEYS.pantryIngredients) {
    pantryIngredients.splice(index, 1);
    save(KEYS.pantryIngredients, pantryIngredients);
  } else {
    pantrySeasonings.splice(index, 1);
    save(KEYS.pantrySeasonings, pantrySeasonings);
  }
  savePantryToFirestore();
  renderPantry();
}

function addPantryItem(inputId, storageKey) {
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if (!name) return;
  const arr = storageKey === KEYS.pantryIngredients ? pantryIngredients : pantrySeasonings;
  if (arr.some(i => i.name === name)) {
    input.style.borderColor = '#FF9800';
    setTimeout(() => { input.style.borderColor = ''; }, 1200);
    return;
  }
  arr.push({ name, checked: true });
  save(storageKey, arr);
  savePantryToFirestore();
  input.value = '';
  renderPantry();
}

document.getElementById('btn-add-ingredient').addEventListener('click', () =>
  addPantryItem('input-new-ingredient', KEYS.pantryIngredients));
document.getElementById('btn-add-seasoning').addEventListener('click', () =>
  addPantryItem('input-new-seasoning', KEYS.pantrySeasonings));
document.getElementById('input-new-ingredient').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPantryItem('input-new-ingredient', KEYS.pantryIngredients);
});
document.getElementById('input-new-seasoning').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPantryItem('input-new-seasoning', KEYS.pantrySeasonings);
});

// ===== Recommend =====
function getRecommendations() {
  const available = {
    ingredients: pantryIngredients.filter(i => i.checked).map(i => i.name),
    seasonings: pantrySeasonings.filter(s => s.checked).map(s => s.name),
  };

  return dishes.map(dish => {
    const missingIngredients = dish.ingredients.filter(i => !available.ingredients.includes(i.name));
    const missingSeasonings = dish.seasonings.filter(s => !available.seasonings.includes(s.name));
    const totalMissing = missingIngredients.length + missingSeasonings.length;
    return { dish, totalMissing, missingIngredients, missingSeasonings };
  }).sort((a, b) => a.totalMissing - b.totalMissing);
}

function renderRecommend() {
  const container = document.getElementById('recommend-list');
  if (dishes.length === 0) {
    container.innerHTML = `<div class="no-recommend">先去「菜单」添加菜谱吧！</div>`;
    return;
  }

  const results = getRecommendations();
  const canCook = results.filter(r => r.totalMissing === 0);
  const almost = results.filter(r => r.totalMissing > 0 && r.totalMissing <= 2);

  if (canCook.length === 0 && almost.length === 0) {
    container.innerHTML = `<div class="no-recommend">根据现有食材，暂时没有可以做的菜。<br>先去「食材库」勾选你有的食材！</div>`;
    return;
  }

  let html = '';

  if (canCook.length > 0) {
    html += `<div class="recommend-section-title">✅ 现在可以做 (${canCook.length})</div>`;
    html += canCook.map(r => `
      <div class="recommend-card can-cook" onclick="viewDish('${r.dish.id}')">
        <div class="recommend-card-header">
          <div class="dish-name">${escHtml(r.dish.name)}</div>
          <span class="status-badge can-cook">可以做！</span>
        </div>
        <div class="dish-tags">
          ${r.dish.mainIngredient ? `<span class="tag main">${escHtml(r.dish.mainIngredient)}</span>` : ''}
          ${r.dish.ingredients.slice(0,4).map(i => `<span class="tag ingredient">${escHtml(i.name)}</span>`).join('')}
        </div>
      </div>`).join('');
  }

  if (almost.length > 0) {
    html += `<div class="recommend-section-title">🛒 差一点 (${almost.length})</div>`;
    html += almost.map(r => {
      const missing = [
        ...r.missingIngredients.map(i => i.name),
        ...r.missingSeasonings.map(s => s.name),
      ];
      return `
        <div class="recommend-card almost" onclick="viewDish('${r.dish.id}')">
          <div class="recommend-card-header">
            <div class="dish-name">${escHtml(r.dish.name)}</div>
            <span class="status-badge almost">缺 ${r.totalMissing} 样</span>
          </div>
          <div class="missing-items">还缺：${missing.map(escHtml).join('、')}</div>
        </div>`;
    }).join('');
  }

  container.innerHTML = html;
}

// ===== Export Menu =====
let exportSelectedIds = new Set();

document.getElementById('btn-export-menu').addEventListener('click', openExportModal);
document.getElementById('export-modal-close').addEventListener('click', closeExportModal);
document.getElementById('export-cancel').addEventListener('click', closeExportModal);
document.getElementById('modal-export-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-export-overlay')) closeExportModal();
});
document.getElementById('export-generate').addEventListener('click', () => {
  if (exportSelectedIds.size === 0) {
    document.getElementById('export-generate').style.animation = 'none';
    document.getElementById('export-dish-list').style.borderColor = '#E53935';
    setTimeout(() => { document.getElementById('export-dish-list').style.borderColor = ''; }, 1200);
    return;
  }
  const selected = dishes.filter(d => exportSelectedIds.has(d.id));
  generateMenuDocument(selected);
  closeExportModal();
});

function openExportModal() {
  if (dishes.length === 0) return;
  exportSelectedIds = new Set(dishes.map(d => d.id)); // default: all selected
  renderExportDishList();
  document.getElementById('modal-export-overlay').classList.remove('hidden');
}

function closeExportModal() {
  document.getElementById('modal-export-overlay').classList.add('hidden');
}

function exportSelectAll(checked) {
  if (checked) exportSelectedIds = new Set(dishes.map(d => d.id));
  else exportSelectedIds = new Set();
  renderExportDishList();
}

function renderExportDishList() {
  const catOrder = ['主菜', '汤', '小菜', '主食', '甜点'];
  const catLabels = { '主菜': '主菜', '汤': '汤', '小菜': '小菜', '主食': '主食', '甜点': '甜点' };
  const groups = {};
  dishes.forEach(d => {
    const key = d.category || '其他';
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  const keys = [...catOrder.filter(k => groups[k]), ...Object.keys(groups).filter(k => !catOrder.includes(k))];

  document.getElementById('export-dish-list').innerHTML = keys.map(cat => `
    <div class="export-category">
      <div class="export-cat-label">${catLabels[cat] || cat}</div>
      ${groups[cat].map(d => `
        <label class="export-dish-row ${exportSelectedIds.has(d.id) ? 'selected' : ''}">
          <input type="checkbox" ${exportSelectedIds.has(d.id) ? 'checked' : ''}
            onchange="toggleExportDish('${d.id}', this.checked)" />
          <span>${escHtml(d.name)}</span>
        </label>`).join('')}
    </div>`).join('');
}

function toggleExportDish(id, checked) {
  if (checked) exportSelectedIds.add(id);
  else exportSelectedIds.delete(id);
  renderExportDishList();
}

function generateMenuDocument(selectedDishes) {
  const catOrder = ['主菜', '汤', '小菜', '主食', '甜点'];
  const catTitles = {
    '主菜': 'MAIN DISHES &nbsp;·&nbsp; 主菜',
    '汤':   'SOUPS &nbsp;·&nbsp; 汤',
    '小菜': 'SIDES &nbsp;·&nbsp; 小菜',
    '主食': 'STAPLES &nbsp;·&nbsp; 主食',
    '甜点': 'DESSERTS &nbsp;·&nbsp; 甜点',
  };

  const groups = {};
  selectedDishes.forEach(d => {
    const key = d.category || '其他';
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });
  const keys = [...catOrder.filter(k => groups[k]), ...Object.keys(groups).filter(k => !catOrder.includes(k))];

  const categoriesHtml = keys.map(cat => {
    const dishesHtml = groups[cat].map(d => {
      const ingNames = d.ingredients.map(i => i.name);
      const keySpiceNames = (d.keySpices || []).map(s => s.name);
      const allNames = [...ingNames, ...keySpiceNames];
      const ingredientLine = allNames.length
        ? `<p class="dish-ingredients">${allNames.map(n => escMenuHtml(n)).join(' &nbsp;·&nbsp; ')}</p>`
        : '';
      return `
        <div class="dish-entry">
          <h3 class="dish-title">${escMenuHtml(d.name)}</h3>
          ${ingredientLine}
        </div>`;
    }).join('');
    return `
      <section class="menu-category">
        <div class="category-heading">
          <div class="category-rule"></div>
          <span class="category-name">${catTitles[cat] || cat.toUpperCase()}</span>
          <div class="category-rule"></div>
        </div>
        ${dishesHtml}
      </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Richard &amp; Cici's Menu</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Georgia, 'Noto Serif SC', 'SimSun', serif;
    background: #ffffff;
    color: #1a1a1a;
    min-height: 100vh;
  }

  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 72px 48px 80px;
  }

  /* Header */
  .menu-header {
    text-align: center;
    margin-bottom: 56px;
  }
  .menu-title {
    font-size: 2rem;
    font-weight: 400;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
  }
  .menu-subtitle {
    font-size: 0.8rem;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 20px;
  }
  .header-ornament {
    width: 48px;
    height: 1px;
    background: #1a1a1a;
    display: inline-block;
    vertical-align: middle;
    margin: 0 12px;
  }
  .header-diamond {
    display: inline-block;
    font-size: 0.5rem;
    vertical-align: middle;
    color: #1a1a1a;
  }

  /* Category */
  .menu-category { margin-bottom: 44px; }

  .category-heading {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 24px;
  }
  .category-rule {
    flex: 1;
    height: 1px;
    background: #1a1a1a;
  }
  .category-name {
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    white-space: nowrap;
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
    font-weight: 500;
  }

  /* Dish entry */
  .dish-entry {
    margin-bottom: 22px;
    padding-bottom: 22px;
    border-bottom: 1px solid #e8e8e8;
  }
  .dish-entry:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  .dish-title {
    font-size: 1.15rem;
    font-weight: 400;
    letter-spacing: 0.02em;
    margin-bottom: 6px;
  }
  .dish-ingredients {
    font-size: 0.78rem;
    color: #666;
    letter-spacing: 0.03em;
    line-height: 1.7;
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
  }

  /* Print button (hidden when printing) */
  .print-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #fff;
    border-top: 1px solid #e0e0e0;
    padding: 14px 24px;
    display: flex;
    justify-content: center;
    gap: 12px;
  }
  .print-btn {
    background: #1a1a1a;
    color: white;
    border: none;
    padding: 10px 28px;
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    cursor: pointer;
    font-family: -apple-system, 'Helvetica Neue', sans-serif;
  }
  .print-btn:hover { background: #333; }

  @media print {
    .print-bar { display: none !important; }
    body { background: white; }
    .page { padding: 24px 32px; }
    .dish-entry { break-inside: avoid; }
    .menu-category { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="menu-header">
    <p class="menu-subtitle">Family Recipe Book</p>
    <h1 class="menu-title">Richard &amp; Cici's Menu</h1>
    <div>
      <span class="header-ornament"></span>
      <span class="header-diamond">&#9670;</span>
      <span class="header-ornament"></span>
    </div>
  </header>
  ${categoriesHtml}
</div>
<div class="print-bar">
  <button class="print-btn" onclick="window.print()">PRINT &nbsp;/&nbsp; 打印为 PDF</button>
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function escMenuHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Shopping List =====
function renderShopping() {
  renderShoppingPicker();
  renderShoppingOutput();
}

function renderShoppingPicker() {
  const el = document.getElementById('shopping-dish-picker');
  if (dishes.length === 0) {
    el.innerHTML = '<div style="color:#999;font-size:0.85rem;padding:8px 0;">先去「菜单」添加菜谱吧！</div>';
    return;
  }
  el.innerHTML = `
    <div class="shopping-picker-title">选择要做的菜：</div>
    ${dishes.map(d => {
      const servings = shoppingSelections[d.id] || 0;
      const checked = servings > 0;
      return `
        <div class="shopping-picker-row ${checked ? 'selected' : ''}">
          <input type="checkbox" id="sp-${d.id}" ${checked ? 'checked' : ''}
            onchange="toggleShoppingDish('${d.id}', this.checked)" />
          <label for="sp-${d.id}">${escHtml(d.name)}</label>
          ${checked ? `
            <div class="servings-inline">
              <button class="servings-btn small" onclick="changeShoppingServings('${d.id}', -1)">−</button>
              <span>${servings} 人份</span>
              <button class="servings-btn small" onclick="changeShoppingServings('${d.id}', 1)">+</button>
            </div>` : ''}
        </div>`;
    }).join('')}`;
}

function toggleShoppingDish(id, checked) {
  const dish = dishes.find(d => d.id === id);
  if (!dish) return;
  if (checked) {
    shoppingSelections[id] = dish.baseServings || 2;
  } else {
    delete shoppingSelections[id];
  }
  save(KEYS.shoppingSelections, shoppingSelections);
  renderShopping();
}

function changeShoppingServings(id, delta) {
  const cur = shoppingSelections[id] || 1;
  const next = Math.max(1, cur + delta);
  shoppingSelections[id] = next;
  save(KEYS.shoppingSelections, shoppingSelections);
  renderShopping();
}

function buildShoppingList() {
  const map = {};
  Object.entries(shoppingSelections).forEach(([dishId, servings]) => {
    const dish = dishes.find(d => d.id === dishId);
    if (!dish) return;
    const ratio = servings / (dish.baseServings || 2);
    const allItems = [...dish.ingredients, ...dish.seasonings];
    allItems.forEach(item => {
      const scaled = scaleAmount(item, ratio);
      const key = item.name + '||' + scaled.unit;
      if (map[key]) {
        if (scaled.unit !== '适量' && scaled.value !== null && map[key].value !== null) {
          map[key].value = Math.round((map[key].value + scaled.value) * 100) / 100;
        }
      } else {
        map[key] = { name: item.name, value: scaled.value, unit: scaled.unit };
      }
    });
  });
  return Object.values(map);
}

function renderShoppingOutput() {
  const el = document.getElementById('shopping-list-output');
  const selected = Object.keys(shoppingSelections);
  if (selected.length === 0) {
    el.innerHTML = '<div class="no-recommend">勾选上方的菜，自动生成购物清单</div>';
    return;
  }
  const items = buildShoppingList();
  const unchecked = items.filter(i => !shoppingChecked.has(i.name + '||' + i.unit));
  const checked = items.filter(i => shoppingChecked.has(i.name + '||' + i.unit));

  el.innerHTML = `
    <div class="shopping-output-title">需要购买（${unchecked.length}）：</div>
    ${unchecked.map(i => shoppingItemHtml(i, false)).join('')}
    ${checked.length > 0 ? `
      <div class="shopping-output-title done" style="margin-top:12px">已购买（${checked.length}）：</div>
      ${checked.map(i => shoppingItemHtml(i, true)).join('')}` : ''}`;
}

function shoppingItemHtml(item, done) {
  const key = item.name + '||' + item.unit;
  return `
    <div class="shopping-item ${done ? 'done' : ''}"
         onclick="toggleShoppingItem(this)" data-key="${escHtml(key)}">
      <span class="check-icon">${done ? '✓' : '○'}</span>
      <span class="shopping-item-name">${escHtml(item.name)}</span>
      <span class="shopping-item-amount">${formatAmount(item.value, item.unit)}</span>
    </div>`;
}

function toggleShoppingItem(el) {
  const key = el.dataset.key;
  if (shoppingChecked.has(key)) shoppingChecked.delete(key);
  else shoppingChecked.add(key);
  save(KEYS.shoppingChecked, [...shoppingChecked]);
  renderShoppingOutput();
}

function clearShoppingChecked() {
  shoppingChecked.clear();
  save(KEYS.shoppingChecked, []);
  renderShoppingOutput();
}

// ===== Utility =====
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== QR Code =====
function showQrModal() {
  const viewUrl = window.location.origin + window.location.pathname + '?view=1';
  const container = document.getElementById('qr-code-container');
  container.innerHTML = '';
  new QRCode(container, {
    text: viewUrl,
    width: 200,
    height: 200,
    colorDark: '#1a1a1a',
    colorLight: '#ffffff',
  });
  document.getElementById('modal-qr-overlay').classList.remove('hidden');
}

// ===== Init =====
renderDishes();
renderPantry();

// ===== Firestore Real-time Listeners =====
if (db) {
  db.collection('dishes').onSnapshot(snapshot => {
    const firestoreDishes = migrateDishes(snapshot.docs.map(doc => doc.data()));
    // Merge: Firestore is source of truth; also update localStorage cache
    dishes = firestoreDishes;
    save(KEYS.dishes, dishes);
    renderDishes();
    if (currentTab === 'recommend') renderRecommend();
    if (currentTab === 'shopping') renderShopping();
  }, () => { /* ignore errors (offline) */ });

  db.collection('app_data').doc('pantry').onSnapshot(doc => {
    if (doc.exists) {
      pantryIngredients = doc.data().ingredients || [];
      pantrySeasonings = doc.data().seasonings || [];
      save(KEYS.pantryIngredients, pantryIngredients);
      save(KEYS.pantrySeasonings, pantrySeasonings);
      renderPantry();
    }
  }, () => { /* ignore errors (offline) */ });
}
