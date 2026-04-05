// ===== Storage Helpers =====
const KEYS = {
  dishes: 'rcm_dishes',
  pantryIngredients: 'rcm_pantry_ingredients',
  pantrySeasonings: 'rcm_pantry_seasonings',
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

// ===== State =====
let dishes = load(KEYS.dishes);
let pantryIngredients = load(KEYS.pantryIngredients);
let pantrySeasonings = load(KEYS.pantrySeasonings);

// Editing state
let editingDishId = null;
let modalIngredients = [];
let modalSeasonings = [];

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

// ===== Render Dish List =====
function renderDishes() {
  const container = document.getElementById('dish-list');
  if (dishes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🍳</div>
        <p>还没有菜谱，点击「添加菜」开始吧！<br>No recipes yet. Click "Add Dish" to start!</p>
      </div>`;
    return;
  }

  const categories = ['主菜', '汤', '小菜', '主食', '甜点'];
  const grouped = {};
  categories.forEach(c => { grouped[c] = []; });
  dishes.forEach(d => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  const categoryLabels = {
    '主菜': '主菜 Main Dish',
    '汤': '汤 Soup',
    '小菜': '小菜 Side Dish',
    '主食': '主食 Staple',
    '甜点': '甜点 Dessert',
  };

  container.innerHTML = categories
    .filter(c => grouped[c].length > 0)
    .map(cat => `
      <div class="category-group">
        <div class="category-label">${categoryLabels[cat] || cat}</div>
        ${grouped[cat].map(dish => `
          <div class="dish-card">
            <div class="dish-info">
              <div class="dish-name">${escHtml(dish.name)}</div>
              <div class="dish-tags">
                ${dish.ingredients.map(i => `<span class="tag ingredient">${escHtml(i.name)}</span>`).join('')}
                ${dish.seasonings.map(s => `<span class="tag seasoning">${escHtml(s.name)}</span>`).join('')}
              </div>
            </div>
            <div class="dish-actions">
              <button class="btn-icon" title="查看" onclick="viewDish('${dish.id}')">👁️</button>
              <button class="btn-icon" title="编辑" onclick="editDish('${dish.id}')">✏️</button>
              <button class="btn-icon" title="删除" onclick="deleteDish('${dish.id}')">🗑️</button>
            </div>
          </div>`).join('')}
      </div>`).join('');
}

// ===== Add/Edit Dish Modal =====
document.getElementById('btn-add-dish').addEventListener('click', () => openModal());
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

function openModal(dish = null) {
  editingDishId = dish ? dish.id : null;
  modalIngredients = dish ? [...dish.ingredients] : [];
  modalSeasonings = dish ? [...dish.seasonings] : [];

  document.getElementById('modal-title').textContent = dish ? '编辑菜 Edit Dish' : '添加菜 Add Dish';
  document.getElementById('dish-name').value = dish ? dish.name : '';
  document.getElementById('dish-category').value = dish ? dish.category : '主菜';
  document.getElementById('input-ingredient-name').value = '';
  document.getElementById('input-ingredient-amount').value = '';
  document.getElementById('input-seasoning-name').value = '';
  document.getElementById('input-seasoning-amount').value = '';

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
      <span class="item-amount">${escHtml(item.amount)}</span>
      <button class="remove-btn" onclick="removeModalItem('ingredient', ${i})">✕</button>
    </div>`).join('') || '<div style="color:#999;font-size:0.8rem;padding:4px 0;">暂无食材 No ingredients</div>';

  seaList.innerHTML = modalSeasonings.map((item, i) => `
    <div class="item-row">
      <span class="item-name">${escHtml(item.name)}</span>
      <span class="item-amount">${escHtml(item.amount)}</span>
      <button class="remove-btn" onclick="removeModalItem('seasoning', ${i})">✕</button>
    </div>`).join('') || '<div style="color:#999;font-size:0.8rem;padding:4px 0;">暂无调味料 No seasonings</div>';
}

function removeModalItem(type, index) {
  if (type === 'ingredient') modalIngredients.splice(index, 1);
  else modalSeasonings.splice(index, 1);
  renderModalItems();
}

document.getElementById('btn-add-ingredient-item').addEventListener('click', () => {
  const name = document.getElementById('input-ingredient-name').value.trim();
  const amount = document.getElementById('input-ingredient-amount').value.trim();
  if (!name) return;
  modalIngredients.push({ name, amount });
  document.getElementById('input-ingredient-name').value = '';
  document.getElementById('input-ingredient-amount').value = '';
  renderModalItems();
  document.getElementById('input-ingredient-name').focus();
});

document.getElementById('btn-add-seasoning-item').addEventListener('click', () => {
  const name = document.getElementById('input-seasoning-name').value.trim();
  const amount = document.getElementById('input-seasoning-amount').value.trim();
  if (!name) return;
  modalSeasonings.push({ name, amount });
  document.getElementById('input-seasoning-name').value = '';
  document.getElementById('input-seasoning-amount').value = '';
  renderModalItems();
  document.getElementById('input-seasoning-name').focus();
});

// Enter key shortcuts in modal
document.getElementById('input-ingredient-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-ingredient-item').click();
});
document.getElementById('input-seasoning-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-seasoning-item').click();
});

document.getElementById('btn-save-dish').addEventListener('click', () => {
  const name = document.getElementById('dish-name').value.trim();
  const category = document.getElementById('dish-category').value;
  if (!name) {
    document.getElementById('dish-name').focus();
    document.getElementById('dish-name').style.borderColor = '#E53935';
    setTimeout(() => { document.getElementById('dish-name').style.borderColor = ''; }, 1500);
    return;
  }

  if (editingDishId) {
    const idx = dishes.findIndex(d => d.id === editingDishId);
    if (idx !== -1) {
      dishes[idx] = { ...dishes[idx], name, category, ingredients: modalIngredients, seasonings: modalSeasonings };
    }
  } else {
    dishes.push({ id: uid(), name, category, ingredients: modalIngredients, seasonings: modalSeasonings });
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
  if (!confirm(`确认删除「${dish.name}」？\nDelete "${dish.name}"?`)) return;
  dishes = dishes.filter(d => d.id !== id);
  save(KEYS.dishes, dishes);
  renderDishes();
}

function viewDish(id) {
  const dish = dishes.find(d => d.id === id);
  if (!dish) return;

  document.getElementById('detail-title').textContent = dish.name;
  const body = document.getElementById('detail-body');

  const ingHtml = dish.ingredients.length
    ? dish.ingredients.map(i => `
        <div class="detail-item">
          <span>${escHtml(i.name)}</span>
          <span class="amount">${escHtml(i.amount)}</span>
        </div>`).join('')
    : '<div style="color:#999;font-size:0.85rem;">暂无</div>';

  const seaHtml = dish.seasonings.length
    ? dish.seasonings.map(s => `
        <div class="detail-item">
          <span>${escHtml(s.name)}</span>
          <span class="amount">${escHtml(s.amount)}</span>
        </div>`).join('')
    : '<div style="color:#999;font-size:0.85rem;">暂无</div>';

  body.innerHTML = `
    <div class="detail-section">
      <h4>🥩 食材 Ingredients</h4>
      ${ingHtml}
    </div>
    <div class="detail-section">
      <h4>🧂 调味料 Seasonings</h4>
      ${seaHtml}
    </div>`;

  document.getElementById('modal-detail-overlay').classList.remove('hidden');
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
  const availableIngredients = pantryIngredients.filter(i => i.checked).map(i => i.name);
  const availableSeasonings = pantrySeasonings.filter(s => s.checked).map(s => s.name);

  return dishes.map(dish => {
    const missingIngredients = dish.ingredients.filter(i => !availableIngredients.includes(i.name));
    const missingSeasonings = dish.seasonings.filter(s => !availableSeasonings.includes(s.name));
    const totalMissing = missingIngredients.length + missingSeasonings.length;
    return { dish, totalMissing, missingIngredients, missingSeasonings };
  }).sort((a, b) => a.totalMissing - b.totalMissing);
}

function renderRecommend() {
  const container = document.getElementById('recommend-list');

  if (dishes.length === 0) {
    container.innerHTML = `<div class="no-recommend">先去「菜单」添加菜谱吧！<br>Add recipes in the "Menu" tab first!</div>`;
    return;
  }

  const results = getRecommendations();
  const canCook = results.filter(r => r.totalMissing === 0);
  const almost = results.filter(r => r.totalMissing > 0 && r.totalMissing <= 2);

  if (canCook.length === 0 && almost.length === 0) {
    container.innerHTML = `<div class="no-recommend">根据现有食材，暂时没有可以做的菜。<br>先去「食材库」勾选你有的食材！<br><br>No dishes available with current pantry.<br>Check off your ingredients in "Pantry" first!</div>`;
    return;
  }

  let html = '';

  if (canCook.length > 0) {
    html += `<div class="recommend-section-title">✅ 现在可以做 Can cook now (${canCook.length})</div>`;
    html += canCook.map(r => `
      <div class="recommend-card can-cook" onclick="viewDish('${r.dish.id}')">
        <div class="recommend-card-header">
          <div class="dish-name">${escHtml(r.dish.name)}</div>
          <span class="status-badge can-cook">可以做！</span>
        </div>
        <div class="dish-tags">
          ${r.dish.ingredients.map(i => `<span class="tag ingredient">${escHtml(i.name)}</span>`).join('')}
          ${r.dish.seasonings.map(s => `<span class="tag seasoning">${escHtml(s.name)}</span>`).join('')}
        </div>
      </div>`).join('');
  }

  if (almost.length > 0) {
    html += `<div class="recommend-section-title">🛒 差一点 Almost there (${almost.length})</div>`;
    html += almost.map(r => {
      const missing = [
        ...r.missingIngredients.map(i => i.name),
        ...r.missingSeasonings.map(s => s.name)
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
