// ===== Storage Helpers =====
const KEYS = {
  dishes: 'rcm_dishes',
  pantryIngredients: 'rcm_pantry_ingredients',
  pantrySeasonings: 'rcm_pantry_seasonings',
  groupBy: 'rcm_group_by',
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

function migrateDishes(raw) {
  return raw.map(d => ({
    ...d,
    mainIngredient: d.mainIngredient || '',
    baseServings: d.baseServings || 2,
    photo: d.photo || null,
    ingredients: migrateItems(d.ingredients),
    seasonings: migrateItems(d.seasonings),
  }));
}

// ===== State =====
let dishes = migrateDishes(load(KEYS.dishes));
let pantryIngredients = load(KEYS.pantryIngredients);
let pantrySeasonings = load(KEYS.pantrySeasonings);
let groupBy = localStorage.getItem(KEYS.groupBy) || 'ingredient'; // 'ingredient' | 'category'

// Modal state
let editingDishId = null;
let modalIngredients = [];
let modalSeasonings = [];
let modalPhoto = null;

// ===== Tab Navigation =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'recommend') renderRecommend();
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

// ===== Render Dish List =====
function renderDishes() {
  const container = document.getElementById('dish-list');
  if (dishes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🍳</div>
        <p>还没有菜谱，点击「添加菜」开始吧！<br>No recipes yet. Click "添加菜" to start!</p>
      </div>`;
    return;
  }

  if (groupBy === 'ingredient') {
    renderGrouped(container, d => d.mainIngredient || '其他', '🥩 ');
  } else {
    const catLabels = {
      '主菜': '主菜 Main Dish', '汤': '汤 Soup',
      '小菜': '小菜 Side Dish', '主食': '主食 Staple', '甜点': '甜点 Dessert',
    };
    renderGrouped(container, d => d.category || '其他', '', catLabels);
  }
}

function renderGrouped(container, keyFn, prefix, labelMap = {}) {
  const groups = {};
  dishes.forEach(d => {
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
  photoInput.value = '';
});

btnRemovePhoto.addEventListener('click', e => {
  e.stopPropagation();
  modalPhoto = null;
  photoPreview.src = '';
  photoPreview.classList.add('hidden');
  photoPlaceholder.style.display = '';
  btnRemovePhoto.classList.add('hidden');
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
  modalPhoto = dish ? dish.photo : null;

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
  } else {
    photoPreview.src = '';
    photoPreview.classList.add('hidden');
    photoPlaceholder.style.display = '';
    btnRemovePhoto.classList.add('hidden');
  }

  // Clear add-item inputs
  ['input-ingredient-name', 'input-ingredient-value', 'input-seasoning-name', 'input-seasoning-value'].forEach(id => {
    document.getElementById(id).value = '';
  });

  renderModalItems();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('dish-name').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function renderModalItems() {
  const ingList = document.getElementById('ingredients-list');
  const seaList = document.getElementById('seasonings-list');

  ingList.innerHTML = modalIngredients.map((item, i) => `
    <div class="item-row">
      <span class="item-name">${escHtml(item.name)}</span>
      <span class="item-amount">${formatAmount(item.value, item.unit)}</span>
      <button class="remove-btn" onclick="removeModalItem('ingredient', ${i})">✕</button>
    </div>`).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无食材</div>';

  seaList.innerHTML = modalSeasonings.map((item, i) => `
    <div class="item-row">
      <span class="item-name">${escHtml(item.name)}</span>
      <span class="item-amount">${formatAmount(item.value, item.unit)}</span>
      <button class="remove-btn" onclick="removeModalItem('seasoning', ${i})">✕</button>
    </div>`).join('') || '<div style="color:#999;font-size:0.8rem;padding:2px 0;">暂无调味料</div>';
}

function removeModalItem(type, index) {
  if (type === 'ingredient') modalIngredients.splice(index, 1);
  else modalSeasonings.splice(index, 1);
  renderModalItems();
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

// Auto-hide value input when "适量" is selected
document.getElementById('input-ingredient-unit').addEventListener('change', function() {
  document.getElementById('input-ingredient-value').disabled = this.value === '适量';
});
document.getElementById('input-seasoning-unit').addEventListener('change', function() {
  document.getElementById('input-seasoning-value').disabled = this.value === '适量';
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
  };

  if (editingDishId) {
    const idx = dishes.findIndex(d => d.id === editingDishId);
    if (idx !== -1) dishes[idx] = { ...dishes[idx], ...dishData };
  } else {
    dishes.push({ id: uid(), ...dishData });
  }

  save(KEYS.dishes, dishes);
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

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-section">
      <h4>🥩 食材 Ingredients</h4>
      ${ingHtml}
    </div>
    <div class="detail-section">
      <h4>🧂 调味料 Seasonings</h4>
      ${seaHtml}
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

// ===== Utility =====
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Init =====
renderDishes();
renderPantry();
