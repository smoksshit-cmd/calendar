import { eventSource, event_types } from '../../../../../script.js';

const $ = id => document.getElementById(id);
const GC = 28;
const THRESH = 8;

/* ═══════════════════════════════════════
   КНОПКА
═══════════════════════════════════════ */
const btn = document.createElement('div');
btn.className = 'bb-btn fa-solid fa-gamepad';
btn.title = 'Игры (двойной клик — сменить игру)';
document.body.appendChild(btn);

function safePos() {
    btn.style.left   = Math.max(0, window.innerWidth  - 54)  + 'px';
    btn.style.top    = Math.max(0, window.innerHeight - 104) + 'px';
    btn.style.bottom = ''; btn.style.right = '';
}
(() => {
    try {
        const s = JSON.parse(localStorage.getItem('bb_btnpos') || 'null');
        if (s) {
            const l = parseFloat(s.l), t = parseFloat(s.t);
            if (l >= 0 && l <= window.innerWidth-44 && t >= 0 && t <= window.innerHeight-44) {
                btn.style.left = l+'px'; btn.style.top = t+'px'; return;
            }
        }
    } catch {}
    safePos();
})();
window.addEventListener('resize', () => {
    const l = parseFloat(btn.style.left), t = parseFloat(btn.style.top);
    if (isNaN(l)||l>window.innerWidth-44||isNaN(t)||t>window.innerHeight-44) safePos();
});

/* drag кнопки */
let _bsx=0,_bsy=0,_box=0,_boy=0,_bdrag=false,_bmoved=false;
btn.addEventListener('mousedown', e => {
    if (e.button!==0) return; e.preventDefault();
    _bdrag=true; _bmoved=false; _bsx=e.clientX; _bsy=e.clientY;
    const r=btn.getBoundingClientRect(); _box=e.clientX-r.left; _boy=e.clientY-r.top;
    btn.style.opacity='0.65';
});
btn.addEventListener('touchstart', e => {
    const t=e.touches[0]; _bdrag=true; _bmoved=false;
    _bsx=t.clientX; _bsy=t.clientY;
    const r=btn.getBoundingClientRect(); _box=t.clientX-r.left; _boy=t.clientY-r.top;
}, { passive:true });
function moveBtn(cx,cy) {
    if (Math.abs(cx-_bsx)>THRESH||Math.abs(cy-_bsy)>THRESH) _bmoved=true;
    btn.style.left  = Math.max(0, Math.min(cx-_box, window.innerWidth-44))  + 'px';
    btn.style.top   = Math.max(0, Math.min(cy-_boy, window.innerHeight-44)) + 'px';
    btn.style.bottom=''; btn.style.right='';
}
function endBtnDrag() {
    if (!_bdrag) return; _bdrag=false; btn.style.opacity='';
    if (_bmoved) localStorage.setItem('bb_btnpos', JSON.stringify({l:btn.style.left,t:btn.style.top}));
}

/* ═══════════════════════════════════════
   УПРАВЛЕНИЕ ПАНЕЛЯМИ И РЕЕСТР ИГР
═══════════════════════════════════════ */
const ALL_GAMES = [
    { id:'blockblast',   icon:'⬛', name:'Block Blast' },
    { id:'minesweeper',  icon:'💣', name:'Сапёр'       },
    { id:'game2048',     icon:'🔢', name:'2048'         },
    { id:'memory',       icon:'🃏', name:'Мемори'       },
    { id:'mahjong',      icon:'🀄', name:'Маджонг'      },
    { id:'flappybird',   icon:'🐦', name:'Flappy Bird'  },
    { id:'sudoku',       icon:'🧩', name:'Судоку'       },
];

function loadEnabledGames() {
    try {
        const raw = localStorage.getItem('bb_enabled_games');
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
        }
    } catch {}
    return new Set(ALL_GAMES.map(g => g.id));
}
function saveEnabledGames() {
    localStorage.setItem('bb_enabled_games', JSON.stringify([...enabledGames]));
}

let enabledGames = loadEnabledGames();
const gameInited = {};

let currentGame = localStorage.getItem('bb_game') || 'blockblast';
if (!enabledGames.has(currentGame)) {
    currentGame = [...enabledGames][0] || 'blockblast';
}

let panelOpen=false, msPanelOpen=false, panel2048Open=false, memPanelOpen=false;
let flappyPanelOpen=false, sudokuPanelOpen=false, mjPanelOpen=false;
let pickerOpen=false, settingsOpen=false;
let singleClickTimer=null;

let panel, msPanel, panel2048, memPanel, flappyPanel, sudokuPanel, mjPanel, pickerEl, settingsEl;

function positionEl(el, w) {
    const r=btn.getBoundingClientRect();
    const pw=w||300, vw=window.innerWidth, vh=window.innerHeight;
    const ph=el.offsetHeight||480;
    const left = r.right+10+pw<=vw ? r.right+10
               : r.left-pw-10>=0  ? r.left-pw-10
               : Math.max(6,(vw-pw)/2);
    const top  = Math.max(6, Math.min(r.top, vh-ph-6));
    el.style.left=left+'px'; el.style.top=top+'px';
}

function updatePickerActive() {
    document.querySelectorAll('.bb-game-card').forEach(c=>c.classList.remove('active'));
    document.getElementById('pick-' + currentGame)?.classList.add('active');
}

function lazyInitGame(id) {
    if (gameInited[id]) return;
    gameInited[id] = true;
    if (id==='blockblast')  newGame();
    if (id==='minesweeper') msNewGame();
    if (id==='game2048')    g2048New();
    if (id==='memory')      memNewGame();
    if (id==='mahjong')     mjNewGame();
    if (id==='sudoku')      suNewGame();
}

function openCurrentGame() {
    closePicker(); closeSettings();
    panel.classList.remove('open');       panelOpen=false;
    msPanel.classList.remove('open');     msPanelOpen=false;
    panel2048.classList.remove('open');   panel2048Open=false;
    memPanel.classList.remove('open');    memPanelOpen=false;
    mjPanel.classList.remove('open');     mjPanelOpen=false;
    flappyPanel.classList.remove('open'); flappyPanelOpen=false; fbStopLoop();
    sudokuPanel.classList.remove('open'); sudokuPanelOpen=false;
    cleanupDrag();
    
    if (currentGame==='blockblast') {
        lazyInitGame('blockblast');
        panel.classList.add('open'); panelOpen=true;
        positionEl(panel, 300);
    } else if (currentGame==='minesweeper') {
        lazyInitGame('minesweeper');
        msPanel.classList.add('open'); msPanelOpen=true;
        positionEl(msPanel, 300);
    } else if (currentGame==='game2048') {
        lazyInitGame('game2048');
        panel2048.classList.add('open'); panel2048Open=true;
        positionEl(panel2048, 300);
    } else if (currentGame==='memory') {
        lazyInitGame('memory');
        memPanel.classList.add('open'); memPanelOpen=true;
        positionEl(memPanel, 400);
    } else if (currentGame==='mahjong') {
        lazyInitGame('mahjong');
        mjPanel.classList.add('open'); mjPanelOpen=true;
        positionEl(mjPanel, 310);
    } else if (currentGame==='flappybird') {
        flappyPanel.classList.add('open'); flappyPanelOpen=true;
        positionEl(flappyPanel, 310);
        fbInit();
    } else if (currentGame==='sudoku') {
        lazyInitGame('sudoku');
        sudokuPanel.classList.add('open'); sudokuPanelOpen=true;
        positionEl(sudokuPanel, 310);
    }
}

function closePanels() {
    panel.classList.remove('open');       panelOpen=false;
    msPanel.classList.remove('open');     msPanelOpen=false;
    panel2048.classList.remove('open');   panel2048Open=false;
    memPanel.classList.remove('open');    memPanelOpen=false;
    mjPanel.classList.remove('open');     mjPanelOpen=false;
    flappyPanel.classList.remove('open'); flappyPanelOpen=false; fbStopLoop();
    sudokuPanel.classList.remove('open'); sudokuPanelOpen=false;
    cleanupDrag();
    clearInterval(memTimer);
    clearInterval(mjTimerInt);
}

function showPicker() {
    pickerOpen=true; updatePickerActive();
    rebuildPickerCards();
    pickerEl.classList.add('open'); positionEl(pickerEl, 280);
}
function closePicker() { pickerOpen=false; pickerEl?.classList.remove('open'); }
function closeSettings() { settingsOpen=false; settingsEl?.classList.remove('open'); }

function handleBtnActivate() {
    if (singleClickTimer) {
        clearTimeout(singleClickTimer); singleClickTimer=null;
        closePanels(); showPicker();
    } else {
        singleClickTimer = setTimeout(() => {
            singleClickTimer=null;
            if (pickerOpen) { closePicker(); return; }
            (panelOpen||msPanelOpen||panel2048Open||memPanelOpen||mjPanelOpen||flappyPanelOpen||sudokuPanelOpen) ? closePanels() : openCurrentGame();
        }, 320);
    }
}

btn.addEventListener('click', e => {
    e.stopPropagation();
    if (_bmoved) { _bmoved=false; return; }
    handleBtnActivate();
});
btn.addEventListener('touchend', e => {
    endBtnDrag();
    if (!_bmoved) { e.preventDefault(); e.stopPropagation(); handleBtnActivate(); }
    _bmoved=false;
});

eventSource.on(event_types.GENERATION_STARTED, () => btn.classList.add('bb-gen'));
eventSource.on(event_types.GENERATION_ENDED,   () => btn.classList.remove('bb-gen'));
eventSource.on(event_types.GENERATION_STOPPED, () => btn.classList.remove('bb-gen'));

/* ═══════════════════════════════════════
   ПАНЕЛИ (Создание UI)
═══════════════════════════════════════ */

/* --- BLOCK BLAST --- */
panel = document.createElement('div');
panel.className = 'bb-panel';
panel.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-block"></span> Block Blast</span>
  <div class="bb-score-box">
    <div class="bb-score-label">Score</div>
    <div class="bb-score" id="bb-score">0</div>
  </div>
</div>
<div class="bb-best">Best: <span id="bb-best">0</span></div>
<div class="bb-board-wrap">
  <div class="bb-board" id="bb-board"></div>
  <div class="bb-over" id="bb-over">
    <h3>Game Over</h3><p id="bb-final"></p>
    <button id="bb-again">Play Again</button>
  </div>
</div>
<div class="bb-msg" id="bb-msg">Drag a piece onto the board</div>
<div class="bb-pieces">
  <div class="bb-slot" id="bb-s0"></div>
  <div class="bb-slot" id="bb-s1"></div>
  <div class="bb-slot" id="bb-s2"></div>
</div>`;
document.body.appendChild(panel);
panel.addEventListener('click', e => e.stopPropagation());
panel.addEventListener('touchend', e => { if (dragIdx===null) e.stopPropagation(); });

/* --- САПЁР --- */
msPanel = document.createElement('div');
msPanel.className = 'bb-panel ms-panel';
msPanel.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-bomb"></span> Сапёр</span>
  <div class="ms-stats">
    <span id="ms-mines-count"><span class="gc-icon gc-icon-flag"></span> 10</span>
    <span id="ms-timer-disp"><span class="gc-icon gc-icon-timer"></span> 0</span>
  </div>
</div>
<div class="bb-board-wrap">
  <div class="ms-board" id="ms-board"></div>
  <div class="bb-over" id="ms-over">
    <h3 id="ms-over-title">Game Over</h3>
    <p id="ms-result"></p>
    <button id="ms-again">Play Again</button>
  </div>
</div>
<div class="ms-footer">
  <span class="ms-hint">Клик: открыть · ПКМ / удержание: 🚩</span>
  <div class="ms-difficulty">
    <button class="ms-diff-btn" data-d="easy">Easy</button>
    <button class="ms-diff-btn" data-d="medium">Med</button>
    <button class="ms-diff-btn" data-d="hard">Hard</button>
  </div>
</div>`;
document.body.appendChild(msPanel);
msPanel.addEventListener('click', e => e.stopPropagation());
msPanel.addEventListener('touchend', e => e.stopPropagation());

/* --- 2048 --- */
panel2048 = document.createElement('div');
panel2048.className = 'bb-panel g2048-panel';
panel2048.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-numbers"></span> 2048</span>
  <div class="bb-score-box">
    <div class="bb-score-label">Score</div>
    <div class="bb-score" id="g2048-score">0</div>
  </div>
</div>
<div class="bb-best">Best: <span id="g2048-best">0</span></div>
<div class="bb-board-wrap">
  <div class="g2048-board" id="g2048-board"></div>
  <div class="bb-over" id="g2048-over">
    <h3 id="g2048-over-title">Game Over</h3>
    <p id="g2048-final"></p>
    <button id="g2048-again">Play Again</button>
  </div>
</div>
<div class="ms-footer">
  <span class="ms-hint">Свайп для управления</span>
</div>`;
document.body.appendChild(panel2048);
panel2048.addEventListener('click', e => e.stopPropagation());

/* --- МЕМОРИ --- */
memPanel = document.createElement('div');
memPanel.className = 'bb-panel mem-panel';
memPanel.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-cards"></span> Мемори</span>
  <div class="mem-hdr-right">
    <div class="mem-timer-box">
      <span class="gc-icon gc-icon-timer"></span>
      <span class="mem-timer-val" id="mem-timer">60</span>
    </div>
    <div class="mem-level-box">Ур. <span id="mem-level-num">1</span></div>
  </div>
</div>
<div class="mem-subhdr">
  <span id="mem-pairs">4 пары</span>
  <span id="mem-best" class="mem-best-txt"></span>
</div>
<div class="bb-board-wrap">
  <div class="mem-board" id="mem-board"></div>
  <div class="bb-over" id="mem-over">
    <h3 id="mem-over-title">🎉 Отлично!</h3>
    <p id="mem-over-result"></p>
    <div class="mem-over-btns">
      <button id="mem-over-next" class="mem-btn-next">Уровень →</button>
      <button id="mem-over-retry">Повторить</button>
    </div>
  </div>
</div>
<div class="ms-footer">
  <span class="ms-hint">Найди все пары карт таро</span>
  <div class="mem-footer-btns">
    <button id="mem-restart-btn" class="mem-restart">↺ Заново</button>
    <button id="mem-reset-btn" class="mem-restart mem-reset">⟪ С 1 ур.</button>
  </div>
</div>`;
document.body.appendChild(memPanel);
memPanel.addEventListener('click', e => e.stopPropagation());
memPanel.addEventListener('touchend', e => e.stopPropagation());

/* --- FLAPPY BIRD --- */
flappyPanel = document.createElement('div');
flappyPanel.className = 'bb-panel fb-panel';
flappyPanel.innerHTML = `
  <div class="bb-header">
    <span class="bb-title"><span class="gc-icon gc-icon-bird"></span> Flappy Bird</span>
    <div class="bb-score-box">
      <div class="bb-score-label">Score</div>
      <div class="bb-score" id="fb-score">0</div>
      <div class="bb-best">Best <span id="fb-best">0</span></div>
    </div>
  </div>
  <div class="fb-wrap">
    <canvas id="fb-canvas" width="288" height="320" class="fb-canvas"></canvas>
  </div>
  <div class="fb-help" id="fb-help">Click / Space to start</div>
`;
document.body.appendChild(flappyPanel);
flappyPanel.addEventListener('click', e => e.stopPropagation());
flappyPanel.addEventListener('touchend', e => e.stopPropagation());

/* --- СУДОКУ --- */
sudokuPanel = document.createElement('div');
sudokuPanel.className = 'bb-panel su-panel';
sudokuPanel.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-cross"></span> Судоку</span>
  <div class="su-hdr-right">
    <div class="su-timer-box"><span class="gc-icon gc-icon-timer"></span> <span id="su-timer">0:00</span></div>
    <div class="su-errors-box"><span class="gc-icon gc-icon-cross"></span> <span id="su-errors">0</span>/3</div>
  </div>
</div>
<div class="bb-board-wrap">
  <div class="su-grid" id="su-grid"></div>
  <div class="bb-over" id="su-over">
    <h3 id="su-over-title">🎉 Победа!</h3>
    <p id="su-over-result"></p>
    <button id="su-again">Сыграть ещё</button>
  </div>
</div>
<div class="su-numpad" id="su-numpad"></div>
<div class="ms-footer">
  <span class="ms-hint">Выбери ячейку → введи цифру</span>
  <div class="ms-difficulty">
    <button class="ms-diff-btn su-diff" data-d="easy">Easy</button>
    <button class="ms-diff-btn su-diff" data-d="medium">Med</button>
    <button class="ms-diff-btn su-diff" data-d="hard">Hard</button>
  </div>
</div>`;
document.body.appendChild(sudokuPanel);
sudokuPanel.addEventListener('click', e => e.stopPropagation());
sudokuPanel.addEventListener('touchend', e => e.stopPropagation());

/* --- МАДЖОНГ --- */
mjPanel = document.createElement('div');
mjPanel.className = 'bb-panel mj-panel';
mjPanel.innerHTML = `
<div class="bb-header">
  <span class="bb-title"><span class="gc-icon gc-icon-star"></span> Маджонг</span>
  <div class="ms-stats" style="gap:5px;">
    <span class="mj-timer-box" id="mj-timer-disp"><span class="gc-icon gc-icon-timer"></span> 0:00</span>
    <span class="mj-pairs-box">Пары: <span id="mj-pairs-disp">0</span></span>
  </div>
</div>
<div class="bb-board-wrap mj-wrap" id="mj-wrap">
  <div class="mj-board" id="mj-board"></div>
  <div class="bb-over" id="mj-over">
    <h3 id="mj-over-title">🎉 Готово!</h3>
    <p id="mj-result"></p>
    <button id="mj-again">Играть ещё</button>
  </div>
</div>
<div class="ms-footer">
  <div style="display:flex; justify-content:space-between; width:100%; align-items:center; padding:0 8px;">
     <span class="ms-hint" id="mj-msg">Найди пары</span>
     <span class="ms-hint" id="mj-moves" style="font-weight:bold;">Ходов: 0</span>
  </div>
  <div class="ms-difficulty" style="margin-top:4px;">
    <button class="ms-diff-btn mj-diff" data-d="easy">🔺 Малый</button>
    <button class="ms-diff-btn mj-diff" data-d="medium">💎 Ромб</button>
    <button class="ms-diff-btn mj-diff" data-d="cross">✚ Крест</button>
    <button class="ms-diff-btn mj-diff" data-d="hard">🀄 Класс</button>
    <button class="ms-diff-btn mj-shuffle" id="mj-shuffle-btn" title="Перемешать оставшиеся плашки">🔀</button>
  </div>
</div>`;
document.body.appendChild(mjPanel);
mjPanel.addEventListener('click', e => e.stopPropagation());
mjPanel.addEventListener('touchend', e => e.stopPropagation());

/* ═══════════════════════════════════════
   ВЫБОР ИГРЫ (ПИКЕР)
═══════════════════════════════════════ */
pickerEl = document.createElement('div');
pickerEl.className = 'bb-picker';
pickerEl.innerHTML = `
<div class="bb-picker-title">
  Выбери игру
  <button class="bb-settings-btn" id="bb-settings-btn" title="Настройки игр"><span class="gc-icon gc-icon-settings"></span></button>
</div>
<div class="bb-picker-row" id="bb-picker-row"></div>`;
document.body.appendChild(pickerEl);
pickerEl.addEventListener('click', e => e.stopPropagation());

settingsEl = document.createElement('div');
settingsEl.className = 'bb-picker bb-settings-panel';
settingsEl.innerHTML = `
<div class="bb-picker-title"><span class="gc-icon gc-icon-settings" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> ИГРЫ</div>
<div class="bb-settings-list" id="bb-settings-list"></div>`;
document.body.appendChild(settingsEl);
settingsEl.addEventListener('click', e => e.stopPropagation());

function rebuildPickerCards() {
    const row = $('bb-picker-row');
    row.innerHTML = '';
    ALL_GAMES.forEach(g => {
        if (!enabledGames.has(g.id)) return;
        const card = document.createElement('div');
        card.className = 'bb-game-card' + (currentGame===g.id ? ' active' : '');
        card.id = 'pick-' + g.id;
        const iconMap = {blockblast:'gc-icon-block',minesweeper:'gc-icon-bomb',game2048:'gc-icon-numbers',memory:'gc-icon-cards',mahjong:'gc-icon-star',flappybird:'gc-icon-bird',sudoku:'gc-icon-cross'};
        const svgCls = iconMap[g.id] || '';
        card.innerHTML = '<div class="bb-game-icon"><span class="gc-icon ' + svgCls + '"></span></div><div class="bb-game-name">' + g.name + '</div>';
        card.addEventListener('click', e => {
            e.stopPropagation();
            currentGame = g.id;
            localStorage.setItem('bb_game', currentGame);
            closePicker();
            openCurrentGame();
        });
        row.appendChild(card);
    });
}

function rebuildSettingsToggles() {
    const list = $('bb-settings-list');
    list.innerHTML = '';
    ALL_GAMES.forEach(g => {
        const row = document.createElement('div');
        row.className = 'bb-settings-row';
        const isOn = enabledGames.has(g.id);
        const imap = {blockblast:'gc-icon-block',minesweeper:'gc-icon-bomb',game2048:'gc-icon-numbers',memory:'gc-icon-cards',mahjong:'gc-icon-star',flappybird:'gc-icon-bird',sudoku:'gc-icon-cross'};
        const sc = imap[g.id] || '';
        row.innerHTML = '<span class="bb-settings-icon"><span class="gc-icon ' + sc + '"></span></span>'
            + '<span class="bb-settings-name">' + g.name + '</span>'
            + '<button class="bb-toggle' + (isOn?' on':'') + '" data-id="' + g.id + '">' + (isOn?'ВКЛ':'ВЫКЛ') + '</button>';
        list.appendChild(row);
    });
    list.querySelectorAll('.bb-toggle').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (enabledGames.has(id)) {
                if (enabledGames.size <= 1) return;
                enabledGames.delete(id);
                if (currentGame === id) {
                    currentGame = [...enabledGames][0];
                    localStorage.setItem('bb_game', currentGame);
                }
            } else {
                enabledGames.add(id);
            }
            saveEnabledGames();
            rebuildSettingsToggles();
        });
    });
}

$('bb-settings-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (settingsOpen) closeSettings();
    else {
        settingsOpen = true;
        rebuildSettingsToggles();
        settingsEl.classList.add('open');
        positionEl(settingsEl, 270);
    }
});

document.addEventListener('click', () => {
    if (settingsOpen) closeSettings();
    if (pickerOpen)   closePicker();
    if (panelOpen||msPanelOpen||panel2048Open||memPanelOpen||mjPanelOpen||flappyPanelOpen||sudokuPanelOpen) closePanels();
});

/* ═══════════════════════════════════════
   МАДЖОНГ — ЛОГИКА
═══════════════════════════════════════ */
const MJ_TILES_ALL = [
    'dot1','dot2','dot3','dot4','dot5','dot6','dot7','dot8','dot9', // Dots
    'bam1','bam2','bam3','bam4','bam5','bam6','bam7','bam8','bam9', // Bamboo
    'chr1','chr2','chr3','chr4','chr5','chr6','chr7','chr8','chr9', // Characters
    'wnd1','wnd2','wnd3','wnd4', // Winds
    'drg_r','drg_g','drg_w' // Dragons
];
const MJ_SPECIALS = [
    ['flw1','flw2','flw3','flw4'], // Flowers
    ['sea1','sea2','sea3','sea4']  // Seasons
];

const MJ_EXT_PATH = 'scripts/extensions/third-party/calendar/games';

function mjTileImg(id) {
    const b = MJ_EXT_PATH;
    if (id.startsWith('dot')) return `${b}/tiles/dots/${id[3]}.png`;
    if (id.startsWith('bam')) return `${b}/tiles/bamboo/${id[3]}.jpg`;
    if (id.startsWith('chr')) return `${b}/tiles/chars/${id[3]}.png`;
    if (id.startsWith('wnd')) return `${b}/tiles/winds/${id[3]}.png`;
    if (id === 'drg_r') return `${b}/tiles/dragons/red.png`;
    if (id === 'drg_g') return `${b}/tiles/dragons/green.png`;
    if (id === 'drg_w') return `${b}/tiles/dragons/white.png`;
    if (id.startsWith('flw')) return `${b}/tiles/flowers/${id[3]}.png`;
    if (id.startsWith('sea')) return `${b}/tiles/seasons/${id[3]}.png`;
    return '';
}

let mjDiff = localStorage.getItem('mj_diff') || 'easy';
let mjTiles = [];
let mjSelected = null;
let mjPairsFound = 0;
let mjTotalPairs = 0;
let mjTimerInt = null;
let mjSecs = 0;
let mjGameOver = false;

// Гарантированно решаемая раскладка:
// паруем свободные плашки по очереди → игра всегда имеет ход
function mjBuildSolvableDeck(layout) {
    const n = layout.length;
    let pos = layout.map((p, i) => ({ ...p, idx: i, done: false }));

    function isFree(t) {
        if (t.done) return false;
        if (pos.find(o => !o.done && o.z === t.z+1 && o.y === t.y && o.x === t.x)) return false;
        let L = pos.find(o => !o.done && o.z === t.z && o.y === t.y && o.x === t.x-1);
        let R = pos.find(o => !o.done && o.z === t.z && o.y === t.y && o.x === t.x+1);
        return !(L && R);
    }

    // Собираем список пар [charA, charB] которые нужно раздать
    let pairs = [];
    if (n === 144) {
        MJ_TILES_ALL.forEach(t => { pairs.push([t,t]); pairs.push([t,t]); }); // 68 пар
        pairs.push(['flw1','flw2'], ['flw3','flw4']); // 2 пары цветков
        pairs.push(['sea1','sea2'], ['sea3','sea4']); // 2 пары сезонов
    } else {
        let types = [...MJ_TILES_ALL].sort(() => Math.random()-0.5);
        for (let i = 0; i < n/2; i++) pairs.push([types[i % types.length], types[i % types.length]]);
    }
    pairs.sort(() => Math.random()-0.5);

    let deck = new Array(n);
    for (let i = 0; i < pairs.length; i++) {
        let free = pos.filter(t => !t.done && isFree(t));
        if (free.length < 2) { // резервный вариант — берём любые оставшиеся
            free = pos.filter(t => !t.done);
            if (free.length < 2) break;
        }
        free.sort(() => Math.random()-0.5);
        deck[free[0].idx] = pairs[i][0];
        deck[free[1].idx] = pairs[i][1];
        free[0].done = true;
        free[1].done = true;
    }
    return deck;
}

function mjMatch(t1, t2) {
    if (t1 === t2) return true;
    if (MJ_SPECIALS[0].includes(t1) && MJ_SPECIALS[0].includes(t2)) return true;
    if (MJ_SPECIALS[1].includes(t1) && MJ_SPECIALS[1].includes(t2)) return true;
    return false;
}

function mjGenLayout(level) {
    let layout = [];
    if (level === 'easy') {
        // 🔺 Пирамида — 36 плашек
        for(let y=0; y<4; y++) for(let x=0; x<6; x++) layout.push({z:0, y, x});
        for(let y=1; y<3; y++) for(let x=1; x<5; x++) layout.push({z:1, y, x});
        for(let y=1; y<3; y++) for(let x=2; x<4; x++) layout.push({z:2, y, x});

    } else if (level === 'medium') {
        // 💎 Ромб — 72 плашки, 3 слоя
        // z=0: ромб  (46)
        [[3,6],[2,7],[1,8],[0,9],[1,8],[2,7],[3,6]].forEach(([xs,xe], y) => {
            for(let x=xs; x<=xe; x++) layout.push({z:0, y, x});
        });
        // z=1: ромб поменьше (18)
        [[4,5],[3,6],[2,7],[3,6],[4,5]].forEach(([xs,xe], i) => {
            const y = i+1;
            for(let x=xs; x<=xe; x++) layout.push({z:1, y, x});
        });
        // z=2: вершина (8)
        [[4,5],[3,6],[4,5]].forEach(([xs,xe], i) => {
            const y = i+2;
            for(let x=xs; x<=xe; x++) layout.push({z:2, y, x});
        });

    } else if (level === 'cross') {
        // ✚ Крест — 68 плашек, 4 слоя
        const addCross = (z, hxs,hxe, vys,vye, xs,xe) => {
            // горизонталь
            for(let x=hxs; x<=hxe; x++) { layout.push({z,y:3,x}); layout.push({z,y:4,x}); }
            // вертикаль (без перекрытия)
            for(let y=vys; y<=vye; y++) if(y!==3&&y!==4) { layout.push({z,y,x:xs}); layout.push({z,y,x:xe}); }
        };
        addCross(0, 0,9,  0,7,  4,5); // 20+12=32
        addCross(1, 1,8,  1,6,  4,5); // 16+8=24
        // z=2: вертикальная колонна в центре
        for(let y=2; y<=5; y++) { layout.push({z:2,y,x:4}); layout.push({z:2,y,x:5}); } // 8
        // z=3: самый верх
        layout.push({z:3,y:3,x:4},{z:3,y:3,x:5},{z:3,y:4,x:4},{z:3,y:4,x:5}); // 4

    } else {
        // 🀄 Классика — 144 плашки
        for(let y=0; y<8; y++) for(let x=0; x<12; x++) layout.push({z:0, y, x});
        for(let y=2; y<6; y++) for(let x=2; x<10; x++) layout.push({z:1, y, x});
        for(let y=3; y<5; y++) for(let x=4; x<8; x++) layout.push({z:2, y, x});
        for(let y=3; y<5; y++) for(let x=5; x<7; x++) layout.push({z:3, y, x});
        layout.push({z:0,y:3,x:-1},{z:0,y:4,x:-1},{z:0,y:3,x:12},{z:0,y:4,x:12});
    }
    return layout;
}

function mjIsFree(tile) {
    if (tile.removed) return false;
    let top = mjTiles.find(t => !t.removed && t.z === tile.z + 1 && t.y === tile.y && t.x === tile.x);
    if (top) return false;
    let left = mjTiles.find(t => !t.removed && t.z === tile.z && t.y === tile.y && t.x === tile.x - 1);
    let right = mjTiles.find(t => !t.removed && t.z === tile.z && t.y === tile.y && t.x === tile.x + 1);
    if (left && right) return false;
    return true;
}

function mjGetMoves() {
    let free = mjTiles.filter(t => !t.removed && mjIsFree(t));
    let moves = 0;
    for(let i=0; i<free.length; i++) {
        for(let j=i+1; j<free.length; j++) {
            if (mjMatch(free[i].char, free[j].char)) moves++;
        }
    }
    return moves;
}

function mjUpdateVisuals() {
    mjTiles.forEach(t => {
        if (t.removed) return;
        const isFree = mjIsFree(t);
        t.el.classList.toggle('blocked', !isFree);
        t.el.classList.toggle('selected', mjSelected === t);
    });
}

function mjCheckState() {
    let moves = mjGetMoves();
    $('mj-moves').textContent = `Ходов: ${moves}`;
    const msg = $('mj-msg');
    $('mj-pairs-disp').textContent = `${mjPairsFound}/${mjTotalPairs}`;
    
    if (mjPairsFound === mjTotalPairs) {
        mjWin();
    } else if (moves === 0) {
        msg.textContent = 'Нет ходов! Перемешайте.';
        msg.style.color = '#e94560';
    } else {
        msg.textContent = 'Найди пары';
        msg.style.color = '#888';
    }
}

function mjClick(tile) {
    if (tile.removed || !mjIsFree(tile) || mjGameOver) return;
    
    if (!mjSelected) {
        mjSelected = tile;
        mjUpdateVisuals();
    } else {
        if (mjSelected === tile) {
            mjSelected = null;
            mjUpdateVisuals();
        } else if (mjMatch(mjSelected.char, tile.char)) {
            mjSelected.removed = true;
            tile.removed = true;
            mjSelected.el.classList.add('removing');
            tile.el.classList.add('removing');
            setTimeout(() => {
                mjSelected.el.style.display = 'none';
                tile.el.style.display = 'none';
                mjSelected = null;
                mjPairsFound++;
                mjUpdateVisuals();
                mjCheckState();
            }, 150);
        } else {
            mjSelected = tile;
            mjUpdateVisuals();
        }
    }
}

function mjShuffleRemaining() {
    if (mjGameOver) return;
    let remaining = mjTiles.filter(t => !t.removed);
    let chars = remaining.map(t => t.char).sort(() => Math.random() - 0.5);
    remaining.forEach((t, i) => {
        t.char = chars[i];
        const img = t.el.querySelector('img');
        if (img) img.src = mjTileImg(t.char);
    });
    mjSelected = null;
    mjUpdateVisuals();
    mjCheckState();
}

function mjRender() {
    let wrap = $('mj-board');
    let container = $('mj-wrap');
    wrap.innerHTML = '';
    
    let minX = Math.min(...mjTiles.map(t=>t.x)), maxX = Math.max(...mjTiles.map(t=>t.x));
    let minY = Math.min(...mjTiles.map(t=>t.y)), maxY = Math.max(...mjTiles.map(t=>t.y));
    let cols = maxX - minX + 1, rows = maxY - minY + 1;

    let tileW = 48, tileH = 66;
    let boardW = cols * tileW, boardH = rows * tileH;

    // Максимальная высота окна доски (px). Шире, чем это значение,
    // окно становиться не может — для крупных раскладок будет скейл.
    const MJ_MAX_H = 460;
    // Сначала ставим контейнеру максимально допустимую высоту,
    // чтобы корректно прочитать его реальную ширину.
    container.style.height = `${MJ_MAX_H}px`;

    let availW = (container.clientWidth  || 320) - 6;
    let availH = MJ_MAX_H - 6;
    // Скейлим по обеим осям, чтобы плитки не вылазили по высоте
    // в сложных раскладках (medium / cross / hard).
    let scale = Math.min(1, availW / boardW, availH / boardH);
    let scaledW = boardW * scale;
    let scaledH = boardH * scale;

    wrap.style.width  = `${boardW}px`;
    wrap.style.height = `${boardH}px`;
    wrap.style.transform = `scale(${scale})`;
    wrap.style.transformOrigin = 'top left';
    wrap.style.marginLeft = `${Math.max(0, (availW - scaledW) / 2)}px`;
    wrap.style.marginTop  = `6px`;

    // Подгоняем высоту контейнера под реальный размер доски,
    // чтобы окно не было «огромным» в простых раскладках (easy).
    // Учитываем небольшой отступ сверху/снизу.
    container.style.height = `${Math.max(200, Math.ceil(scaledH) + 16)}px`;

    mjTiles.forEach(t => {
        let el = document.createElement('div');
        el.className = 'mj-tile';
        el.style.zIndex = t.z * 1000 + t.y * 100 + t.x;
        
        let left = (t.x - minX) * tileW - (t.z * 4);
        let top  = (t.y - minY) * tileH - (t.z * 4);
        el.style.left = left + 'px';
        el.style.top  = top  + 'px';

        let img = document.createElement('img');
        img.src = mjTileImg(t.char);
        img.alt = '';
        img.draggable = false;
        el.appendChild(img);

        el.addEventListener('click',    e => { e.stopPropagation(); mjClick(t); });
        el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); mjClick(t); });
        t.el = el;
        wrap.appendChild(el);
    });
    mjUpdateVisuals();
    mjCheckState();
}

function mjNewGame() {
    clearInterval(mjTimerInt);
    mjSecs = 0; mjPairsFound = 0; mjSelected = null; mjGameOver = false;
    $('mj-over').classList.remove('show');
    $('mj-msg').style.color = '#888';
    
    let layout = mjGenLayout(mjDiff);
    let deck = mjBuildSolvableDeck(layout);
    mjTotalPairs = layout.length / 2;
    
    mjTiles = layout.map((pos, i) => ({ ...pos, char: deck[i], removed: false, el: null }));
    
    mjRender();
    
    mjPanel.querySelectorAll('.mj-diff').forEach(b => b.classList.toggle('active', b.dataset.d === mjDiff));
    
    $('mj-timer-disp').innerHTML = '<span class="gc-icon gc-icon-timer"></span> 0:00';
    mjTimerInt = setInterval(() => {
        if (mjGameOver) return;
        mjSecs++;
        let m = Math.floor(mjSecs/60), s = mjSecs%60;
        $('mj-timer-disp').innerHTML = `<span class="gc-icon gc-icon-timer"></span> ${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
}

function mjWin() {
    mjGameOver = true;
    clearInterval(mjTimerInt);
    let m = Math.floor(mjSecs/60), s = mjSecs%60;
    let bKey = `mj_best_${mjDiff}`;
    let prev = +localStorage.getItem(bKey) || 0;
    if (!prev || mjSecs < prev) localStorage.setItem(bKey, mjSecs);
    let best = +localStorage.getItem(bKey);
    let bm = Math.floor(best/60), bs = best%60;
    
    $('mj-result').textContent = `Время: ${m}:${s.toString().padStart(2,'0')} · Рекорд: ${bm}:${bs.toString().padStart(2,'0')}`;
    setTimeout(() => $('mj-over').classList.add('show'), 400);
}

$('mj-again').addEventListener('click', e => { e.stopPropagation(); mjNewGame(); });
$('mj-again').addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); mjNewGame(); });
$('mj-shuffle-btn').addEventListener('click', e => { e.stopPropagation(); mjShuffleRemaining(); });
$('mj-shuffle-btn').addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); mjShuffleRemaining(); });

mjPanel.querySelectorAll('.mj-diff').forEach(b => {
    b.addEventListener('click', e => {
        e.stopPropagation();
        mjDiff = b.dataset.d; localStorage.setItem('mj_diff', mjDiff);
        mjNewGame();
    });
});


/* ═══════════════════════════════════════
   ОСТАЛЬНЫЕ ИГРЫ (Оригинальная логика)
═══════════════════════════════════════ */

/* --- Block Blast Логика --- */
const ROWS=8, COLS=8;
const COLORS=['#e94560','#f5a623','#4caf50','#2196f3','#9c27b0','#00bcd4','#ff5722','#e91e63'];
const SHAPES=[
    [[1,1],[1,1]],[[1,1,1]],[[1],[1],[1]],[[1,1,1,1]],[[1],[1],[1],[1]],
    [[1,1,1],[1,0,0]],[[1,1,1],[0,0,1]],[[1,0],[1,1],[0,1]],[[0,1],[1,1],[1,0]],
    [[1,1,1],[0,1,0]],[[1]],[[1,1]],[[1],[1]],
    [[1,0],[1,0],[1,1]],[[0,1],[0,1],[1,1]],[[1,1,1],[1,0,0],[1,0,0]],
];
let board, score, pieces, dead;
let best = +localStorage.getItem('bb_best') || 0;
$('bb-best').textContent = best;
const rnd = n => Math.floor(Math.random()*n);
const sum = n => n.flat().reduce((a,v)=>a+v, 0);

function canPlace(shape,r,c) {
    for (let dr=0;dr<shape.length;dr++)
        for (let dc=0;dc<shape[dr].length;dc++)
            if (shape[dr][dc]&&(r+dr>=ROWS||c+dc>=COLS||board[r+dr][c+dc])) return false;
    return true;
}
function fitsAnywhere(shape) {
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (canPlace(shape,r,c)) return true;
    return false;
}
function newGame() {
    board=Array.from({length:ROWS},()=>Array(COLS).fill(null));
    score=0; dead=false;
    $('bb-score').textContent='0'; $('bb-over').classList.remove('show');
    msg('Drag a piece onto the board'); drawBoard(); spawn();
}
function spawn() {
    pieces=[mkP(),mkP(),mkP()]; drawPieces();
    if (!pieces.some(p=>fitsAnywhere(p.shape))) gameOver();
}
function mkP() { return {shape:SHAPES[rnd(SHAPES.length)], color:COLORS[rnd(COLORS.length)], used:false}; }
function doPlace(pIdx,row,col) {
    const p=pieces[pIdx];
    if (!canPlace(p.shape,row,col)) { msg("Can't place here!",'bad'); return false; }
    for (let dr=0;dr<p.shape.length;dr++)
        for (let dc=0;dc<p.shape[dr].length;dc++)
            if (p.shape[dr][dc]) board[row+dr][col+dc]=p.color;
    p.used=true; score+=sum(p.shape);
    const cl=clearLines(); score+=cl*20;
    updateScore(); drawBoard(); drawPieces();
    if (cl) msg(`+${cl} line${cl>1?'s':''} cleared! 🎉`,'good');
    else msg('Drag a piece onto the board');
    if (pieces.every(p=>p.used)) spawn();
    else if (!pieces.filter(p=>!p.used).some(p=>fitsAnywhere(p.shape))) gameOver();
    return true;
}
function clearLines() {
    const f=new Set();
    for (let r=0;r<ROWS;r++) if (board[r].every(v=>v)) for (let c=0;c<COLS;c++) f.add(`${r}_${c}`);
    for (let c=0;c<COLS;c++) if (board.every(r=>r[c])) for (let r=0;r<ROWS;r++) f.add(`${r}_${c}`);
    let rows=new Set(), cols=new Set();
    f.forEach(k=>{const[r,c]=k.split('_'); rows.add(r); cols.add(c);});
    let cl=0;
    for (const r of rows) if ([...Array(COLS).keys()].every(c=>f.has(`${r}_${c}`))) cl++;
    for (const c of cols) if ([...Array(ROWS).keys()].every(r=>f.has(`${r}_${c}`))) cl++;
    f.forEach(k=>{
        const[r,c]=k.split('_').map(Number); board[r][c]=null;
        const el=$('bb-board')?.querySelector(`[data-r="${r}"][data-c="${c}"]`);
        if (el){el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),300);}
    });
    return cl;
}
function updateScore() {
    $('bb-score').textContent=score;
    if (score>best){best=score; localStorage.setItem('bb_best',best); $('bb-best').textContent=best;}
}
function gameOver(){dead=true; $('bb-final').textContent=`Score: ${score}  •  Best: ${best}`; $('bb-over').classList.add('show');}
function msg(t,type){const e=$('bb-msg'); e.textContent=t; e.className='bb-msg'+(type?` ${type}`:'');}

function drawBoard() {
    const brd=$('bb-board'); brd.querySelectorAll('.bb-cell').forEach(e=>e.remove());
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
        const el=document.createElement('div');
        el.className='bb-cell'+(board[r][c]?' filled':'');
        if (board[r][c]) el.style.background=board[r][c];
        el.dataset.r=r; el.dataset.c=c; brd.appendChild(el);
    }
}
function showGhost(shape,row,col,color) {
    clearGhost(); if (!canPlace(shape,row,col)) return;
    for (let dr=0;dr<shape.length;dr++) for (let dc=0;dc<shape[dr].length;dc++) if (shape[dr][dc]) {
        const el=$('bb-board')?.querySelector(`[data-r="${row+dr}"][data-c="${col+dc}"]`);
        if (el){el.classList.add('ghost','filled'); el.style.background=color;}
    }
}
function clearGhost() {
    $('bb-board')?.querySelectorAll('.bb-cell.ghost').forEach(el=>{
        const r=+el.dataset.r, c=+el.dataset.c;
        el.classList.remove('ghost','filled');
        el.style.background=board[r][c]||'';
        if (!board[r][c]) el.classList.remove('filled');
    });
}
let dragIdx=null, dragGhost=null, dragOffX=0, dragOffY=0;
function cleanupDrag() {
    if (dragGhost){dragGhost.remove(); dragGhost=null;}
    clearGhost();
    if (dragIdx!==null){const s=$(`bb-s${dragIdx}`); if(s) s.classList.remove('dragging'); dragIdx=null;}
}
function buildGhostEl(piece) {
    const el=document.createElement('div');
    el.className='bb-drag-ghost';
    el.style.gridTemplateColumns=`repeat(${piece.shape[0].length},${GC}px)`;
    piece.shape.forEach(row=>row.forEach(v=>{
        const c=document.createElement('div'); c.className='bb-dc';
        c.style.background=v?piece.color:'transparent';
        if (!v) c.style.boxShadow='none'; el.appendChild(c);
    }));
    document.body.appendChild(el); return el;
}
function startPieceDrag(idx,cx,cy,pgridEl) {
    dragIdx=idx;
    const rect=pgridEl.getBoundingClientRect();
    dragOffX=cx-rect.left; dragOffY=cy-rect.top;
    dragGhost=buildGhostEl(pieces[idx]);
    movePieceDrag(cx,cy);
    $(`bb-s${idx}`)?.classList.add('dragging');
}
function movePieceDrag(cx,cy) {
    if (!dragGhost) return;
    const gl=cx-dragOffX, gt=cy-dragOffY;
    dragGhost.style.left=gl+'px'; dragGhost.style.top=gt+'px';
    dragGhost.style.visibility='hidden';
    const el=document.elementFromPoint(gl+GC/2, gt+GC/2);
    dragGhost.style.visibility='';
    if (el?.classList.contains('bb-cell')) showGhost(pieces[dragIdx].shape,+el.dataset.r,+el.dataset.c,pieces[dragIdx].color);
    else clearGhost();
}
function endPieceDrag(cx,cy) {
    if (!dragGhost) return;
    const gl=cx-dragOffX, gt=cy-dragOffY;
    dragGhost.remove(); dragGhost=null; clearGhost();
    $(`bb-s${dragIdx}`)?.classList.remove('dragging');
    const el=document.elementFromPoint(gl+GC/2, gt+GC/2);
    const idx=dragIdx; dragIdx=null;
    if (el?.classList.contains('bb-cell')&&!dead) doPlace(idx,+el.dataset.r,+el.dataset.c);
    else drawPieces();
}
function drawPieces() {
    for (let i=0;i<3;i++) {
        const old=$(`bb-s${i}`);
        const slot=old.cloneNode(false); slot.id=`bb-s${i}`;
        old.parentNode.replaceChild(slot,old);
        const p=pieces[i];
        slot.className='bb-slot'+(p.used?' used':'');
        if (p.used) continue;
        slot.addEventListener('mousedown',e=>{
            if(dead)return; e.preventDefault(); e.stopPropagation();
            startPieceDrag(i,e.clientX,e.clientY,slot.querySelector('.bb-pgrid')||slot);
        });
        slot.addEventListener('touchstart',e=>{
            if(dead)return; e.stopPropagation();
            const t=e.touches[0];
            startPieceDrag(i,t.clientX,t.clientY,slot.querySelector('.bb-pgrid')||slot);
        },{passive:true});
        const g=document.createElement('div'); g.className='bb-pgrid';
        g.style.gridTemplateColumns=`repeat(${p.shape[0].length},18px)`;
        p.shape.forEach(row=>row.forEach(v=>{
            const c=document.createElement('div'); c.className='bb-pcell';
            c.style.width='18px'; c.style.height='18px';
            c.style.background=v?p.color:'transparent';
            if (!v) c.style.boxShadow='none'; g.appendChild(c);
        }));
        slot.appendChild(g);
    }
}
document.addEventListener('mousemove', e => {
    if (_bdrag) moveBtn(e.clientX,e.clientY);
    if (dragIdx!==null) movePieceDrag(e.clientX,e.clientY);
});
document.addEventListener('mouseup', e => {
    endBtnDrag();
    if (dragIdx!==null) endPieceDrag(e.clientX,e.clientY);
});
document.addEventListener('touchmove', e => {
    const t=e.touches[0];
    if (dragIdx!==null){movePieceDrag(t.clientX,t.clientY); e.preventDefault();}
    else if (_bdrag){moveBtn(t.clientX,t.clientY); e.preventDefault();}
},{passive:false});
document.addEventListener('touchend', e => {
    endBtnDrag();
    if (dragIdx!==null){const t=e.changedTouches[0]; endPieceDrag(t.clientX,t.clientY);}
});
$('bb-again').addEventListener('click',    e=>{e.stopPropagation(); newGame();});
$('bb-again').addEventListener('touchend', e=>{e.preventDefault(); e.stopPropagation(); newGame();});

/* --- Сапёр Логика --- */
const MS_CFG = { easy: {rows:9, cols:9, mines:10}, medium: {rows:9, cols:9, mines:15}, hard: {rows:9, cols:9, mines:20} };
let msDiff = localStorage.getItem('ms_diff') || 'easy', msCells = [];
let msMineTotal, msFlags, msRevCount, msDead, msWon, msStarted, msTimerInt = null, msSecs = 0;
function msNewGame() {
    const cfg = MS_CFG[msDiff]; clearInterval(msTimerInt); msTimerInt=null; msSecs=0;
    msMineTotal=cfg.mines; msFlags=0; msRevCount=0; msDead=false; msWon=false; msStarted=false;
    $('ms-mines-count').textContent=`🚩 ${msMineTotal}`; $('ms-timer-disp').textContent=`⏱ 0`;
    $('ms-over').classList.remove('show'); msDrawBoard(cfg);
}
function msDrawBoard({rows,cols}) {
    const brd=$('ms-board'); brd.style.gridTemplateColumns=`repeat(${cols},1fr)`; brd.innerHTML='';
    msCells = Array.from({length:rows}, (_,r) => Array.from({length:cols}, (_,c) => {
        const el=document.createElement('div'); el.className='ms-cell'; el.dataset.r=r; el.dataset.c=c;
        let _lpt=null, _lpf=false, _lastT=0, _mlpt=null, _mlf=false;
        el.addEventListener('mousedown', e => {
            if (e.button!==0) return; e.stopPropagation(); _mlf=false;
            _mlpt=setTimeout(()=>{ _mlf=true; _mlpt=null; msFlag(r,c); }, 500);
        });
        el.addEventListener('mouseup', ()=>{ if (_mlpt){clearTimeout(_mlpt); _mlpt=null;} });
        el.addEventListener('mouseleave', ()=>{ if (_mlpt){clearTimeout(_mlpt); _mlpt=null;} });
        el.addEventListener('click', e => {
            e.stopPropagation(); if (Date.now()-_lastT<350) return;
            if (_mlf) { _mlf=false; return; } msReveal(r,c);
        });
        el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); msFlag(r,c); });
        el.addEventListener('touchstart', e => {
            e.stopPropagation(); _lpf=false; _lpt=setTimeout(()=>{ _lpf=true; msFlag(r,c); },500);
        },{passive:true});
        el.addEventListener('touchend', e => {
            e.stopPropagation(); _lastT=Date.now();
            if (_lpt){clearTimeout(_lpt); _lpt=null;}
            if (!_lpf) msReveal(r,c); _lpf=false;
        });
        el.addEventListener('touchmove', ()=>{ if (_lpt){clearTimeout(_lpt); _lpt=null;} });
        brd.appendChild(el); return {el, value:0, revealed:false, flagged:false};
    }));
}
function msPlaceMines(rows,cols,mines,safeR,safeC) {
    const grid=Array.from({length:rows},()=>Array(cols).fill(0)), safe=new Set();
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
        const nr=safeR+dr, nc=safeC+dc; if (nr>=0&&nr<rows&&nc>=0&&nc<cols) safe.add(`${nr},${nc}`);
    }
    let placed=0;
    while (placed<mines) {
        const r=rnd(rows), c=rnd(cols);
        if (!grid[r][c]&&!safe.has(`${r},${c}`)){grid[r][c]=-1; placed++;}
    }
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
        if (grid[r][c]===-1) continue; let n=0;
        for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
            const nr=r+dr, nc=c+dc; if (nr>=0&&nr<rows&&nc>=0&&nc<cols&&grid[nr][nc]===-1) n++;
        }
        grid[r][c]=n;
    }
    return grid;
}
function msReveal(r,c) {
    if (msDead||msWon) return; const cfg=MS_CFG[msDiff], cell=msCells[r]?.[c];
    if (!cell||cell.revealed||cell.flagged) return;
    if (!msStarted) {
        msStarted=true; const grid=msPlaceMines(cfg.rows,cfg.cols,cfg.mines,r,c);
        msCells.forEach((row,ri)=>row.forEach((cel,ci)=>{ cel.value=grid[ri][ci]; }));
        msTimerInt=setInterval(()=>{ msSecs++; $('ms-timer-disp').innerHTML=`<span class="gc-icon gc-icon-timer"></span> ${msSecs}`; },1000);
    }
    if (cell.value===-1) {
        cell.revealed=true; cell.el.classList.add('revealed','mine-hit'); cell.el.textContent='💥';
        msDead=true; clearInterval(msTimerInt);
        setTimeout(()=>{
            msCells.flat().forEach(cc=>{
                if (cc.value===-1&&!cc.revealed){cc.el.classList.add('revealed','mine-reveal'); cc.el.textContent='💣';}
                if (cc.flagged&&cc.value!==-1) cc.el.textContent='❌';
            });
            $('ms-over-title').textContent='💥 Подрыв!'; $('ms-result').textContent=`Время: ${msSecs}с`;
            $('ms-over').classList.add('show');
        }, 600); return;
    }
    msFlood(r,c,cfg); msCheckWin(cfg);
}
function msFlood(r,c,cfg) {
    const q=[[r,c]], vis=new Set([`${r},${c}`]);
    while (q.length) {
        const [cr,cc]=q.shift(), cell=msCells[cr][cc];
        if (cell.revealed||cell.flagged) continue;
        cell.revealed=true; cell.el.classList.add('revealed'); msRevCount++;
        if (cell.value>0){ cell.el.textContent=cell.value; cell.el.classList.add(`ms-n${cell.value}`); }
        if (cell.value===0) {
            for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
                const nr=cr+dr, nc=cc+dc;
                if (nr>=0&&nr<cfg.rows&&nc>=0&&nc<cfg.cols&&!vis.has(`${nr},${nc}`)){ vis.add(`${nr},${nc}`); q.push([nr,nc]); }
            }
        }
    }
}
function msFlag(r,c) {
    if (msDead||msWon||!msStarted) return; const cell=msCells[r]?.[c]; if (!cell||cell.revealed) return;
    cell.flagged=!cell.flagged;
    if (cell.flagged){cell.el.classList.add('flagged'); cell.el.textContent='🚩'; msFlags++;}
    else{cell.el.classList.remove('flagged'); cell.el.textContent=''; msFlags--;}
    $('ms-mines-count').textContent=`🚩 ${msMineTotal-msFlags}`;
}
function msCheckWin(cfg) {
    if (msRevCount===cfg.rows*cfg.cols-cfg.mines) {
        msWon=true; clearInterval(msTimerInt);
        msCells.flat().forEach(cc=>{ if (!cc.revealed&&!cc.flagged){cc.el.textContent='🚩'; cc.el.classList.add('flagged');} });
        const bKey=`ms_best_${msDiff}`, prev=+localStorage.getItem(bKey)||0;
        if (!prev||msSecs<prev) localStorage.setItem(bKey,msSecs);
        $('ms-over-title').textContent='🎉 Победа!'; $('ms-result').textContent=`Время: ${msSecs}с · Рекорд: ${localStorage.getItem(bKey)}с`;
        $('ms-over').classList.add('show');
    }
}
$('ms-again').addEventListener('click',    e=>{e.stopPropagation(); msNewGame();});
$('ms-again').addEventListener('touchend', e=>{e.preventDefault(); e.stopPropagation(); msNewGame();});
msPanel.querySelectorAll('.ms-diff-btn').forEach(b=>{
    if (b.dataset.d===msDiff && !b.classList.contains('mj-diff') && !b.classList.contains('su-diff')) b.classList.add('active');
    if(!b.classList.contains('mj-diff') && !b.classList.contains('su-diff')) {
        b.addEventListener('click', e=>{
            e.stopPropagation(); msDiff=b.dataset.d; localStorage.setItem('ms_diff',msDiff);
            msPanel.querySelectorAll('.ms-diff-btn').forEach(x=>x.classList.remove('active'));
            b.classList.add('active'); msNewGame();
        });
    }
});

/* --- 2048 Логика --- */
let g2048Grid, g2048Score, g2048Dead, g2048Won, g2048Best = +localStorage.getItem('g2048_best') || 0;
$('g2048-best').textContent = g2048Best;
function g2048New() {
    g2048Grid = Array.from({length:4}, () => Array(4).fill(0));
    g2048Score = 0; g2048Dead = false; g2048Won = false;
    $('g2048-score').textContent = '0'; $('g2048-over').classList.remove('show');
    g2048Spawn(); g2048Spawn(); g2048Draw();
}
function g2048Spawn() {
    const empty = []; for (let r=0; r<4; r++) for (let c=0; c<4; c++) if (!g2048Grid[r][c]) empty.push([r,c]);
    if (!empty.length) return; const [r,c] = empty[rnd(empty.length)]; g2048Grid[r][c] = Math.random() < 0.9 ? 2 : 4;
}
function g2048Draw() {
    const brd = $('g2048-board'); brd.innerHTML = '';
    for (let r=0; r<4; r++) for (let c=0; c<4; c++) {
        const el = document.createElement('div'), v = g2048Grid[r][c];
        el.className = 'g2048-cell' + (v ? ` g2048-v${v <= 2048 ? v : 'max'}` : '');
        if (v) el.textContent = v; brd.appendChild(el);
    }
}
function g2048Move(dir) {
    if (g2048Dead || g2048Won) return; const prevStr = JSON.stringify(g2048Grid);
    for (let i=0; i<4; i++) {
        let line = (dir==='left'||dir==='right') ? g2048Grid[i].slice() : [g2048Grid[0][i],g2048Grid[1][i],g2048Grid[2][i],g2048Grid[3][i]];
        if (dir==='right'||dir==='down') line.reverse();
        const nonz = line.filter(v => v);
        for (let j=0; j<nonz.length-1; j++) {
            if (nonz[j]===nonz[j+1]) {
                nonz[j]*=2; g2048Score+=nonz[j]; if (nonz[j]===2048) g2048Won=true; nonz.splice(j+1,1);
            }
        }
        while (nonz.length<4) nonz.push(0);
        if (dir==='right'||dir==='down') nonz.reverse();
        if (dir==='left'||dir==='right') g2048Grid[i]=nonz;
        else for (let r=0; r<4; r++) g2048Grid[r][i]=nonz[r];
    }
    if (JSON.stringify(g2048Grid)!==prevStr) g2048Spawn();
    $('g2048-score').textContent = g2048Score;
    if (g2048Score > g2048Best) { g2048Best = g2048Score; localStorage.setItem('g2048_best', g2048Best); $('g2048-best').textContent = g2048Best; }
    g2048Draw();
    if (g2048Won) { $('g2048-over-title').textContent='🎉 2048!'; $('g2048-final').textContent=`Score: ${g2048Score}`; $('g2048-over').classList.add('show'); return; }
    if (!g2048CanMove()) { g2048Dead=true; $('g2048-over-title').textContent='😵 Game Over'; $('g2048-final').textContent=`Score: ${g2048Score}`; $('g2048-over').classList.add('show'); }
}
function g2048CanMove() {
    for (let r=0; r<4; r++) for (let c=0; c<4; c++) {
        if (!g2048Grid[r][c]) return true;
        if (c<3 && g2048Grid[r][c]===g2048Grid[r][c+1]) return true;
        if (r<3 && g2048Grid[r][c]===g2048Grid[r+1][c]) return true;
    } return false;
}
let _g2sx=0, _g2sy=0, _g2drag=false;
panel2048.addEventListener('mousedown', e=>{ _g2sx=e.clientX; _g2sy=e.clientY; _g2drag=true; });
panel2048.addEventListener('mouseup', e=>{
    if (!_g2drag) return; _g2drag=false; const dx=e.clientX-_g2sx, dy=e.clientY-_g2sy;
    if (Math.abs(dx)<30&&Math.abs(dy)<30) return;
    if (Math.abs(dx)>Math.abs(dy)) g2048Move(dx>0?'right':'left'); else g2048Move(dy>0?'down':'up');
});
panel2048.addEventListener('mouseleave', ()=>{ _g2drag=false; });
panel2048.addEventListener('touchstart', e=>{ e.stopPropagation(); const t=e.touches[0]; _g2sx=t.clientX; _g2sy=t.clientY; },{passive:true});
panel2048.addEventListener('touchend', e=>{
    e.stopPropagation(); const dx=e.changedTouches[0].clientX-_g2sx, dy=e.changedTouches[0].clientY-_g2sy;
    if (Math.abs(dx)<30&&Math.abs(dy)<30) return;
    if (Math.abs(dx)>Math.abs(dy)) g2048Move(dx>0?'right':'left'); else g2048Move(dy>0?'down':'up');
});
$('g2048-again').addEventListener('click', e=>{e.stopPropagation(); g2048New();});
$('g2048-again').addEventListener('touchend', e=>{e.preventDefault(); e.stopPropagation(); g2048New();});

/* --- Мемори Логика --- */
const MEM_EXT_PATH = 'scripts/extensions/third-party/calendar/games';
const MEM_CARDS_ALL = ['death','emperor','empress','justice','sun','the_devil','the_fool_2v','the_fool','the_hanged_man','the_hermit','the_high_priestess','the_lovers_2v','the_lovers','the_moon','the_star','the_tower','the_world','wheel_of_fortune'];
const MEM_LEVELS = [{ pairs:2, time:40, cols:2 }, { pairs:4, time:60, cols:4 }, { pairs:6, time:90, cols:4 }, { pairs:8, time:120, cols:4 }];
let memLevel = +localStorage.getItem('mem_level') || 1, memCards = [], memFlipped = [], memMatches = 0, memTimer = null, memTimeLeft = 0, memLocked = false, memGameActive = false, memBest = JSON.parse(localStorage.getItem('mem_best') || '{}');
function memShuffle(arr) { const a=[...arr]; for (let i=a.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function memGetCfg() { return MEM_LEVELS[Math.min(memLevel-1, MEM_LEVELS.length-1)]; }
function memPickCards(pairs) { return memShuffle([...MEM_CARDS_ALL]).slice(0, pairs); }
function memNewGame() {
    clearInterval(memTimer); memFlipped = []; memMatches = 0; memLocked = false; memGameActive = true;
    const cfg = memGetCfg(); memTimeLeft = cfg.time;
    const picked = memPickCards(cfg.pairs);
    memCards = memShuffle([...picked, ...picked].map((img, i) => ({ id:i, img, revealed:false, matched:false, el:null })));
    $('mem-level-num').textContent = memLevel; $('mem-pairs').textContent = `${cfg.pairs} пар · ${cfg.time}с`;
    $('mem-timer').textContent = cfg.time; $('mem-timer').style.color = ''; $('mem-over').classList.remove('show');
    memUpdateBest(); memRenderBoard(cfg.cols); memStartTimer();
}
function memStartTimer() {
    clearInterval(memTimer);
    memTimer = setInterval(() => {
        memTimeLeft--;
        const timerEl = $('mem-timer'); if (timerEl) { timerEl.textContent = memTimeLeft; timerEl.style.color = memTimeLeft <= 10 ? '#e94560' : ''; }
        if (memTimeLeft <= 0) { clearInterval(memTimer); memGameOver(false); }
    }, 1000);
}
function memRenderBoard(cols) {
    const board = $('mem-board'); board.innerHTML = ''; board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    memCards.forEach((card, idx) => {
        const el = document.createElement('div'); el.className = 'mem-card';
        el.innerHTML = `<div class="mem-card-inner"><div class="mem-card-back"><img src="${MEM_EXT_PATH}/images/back.png" draggable="false"></div><div class="mem-card-front"><img src="${MEM_EXT_PATH}/images/${card.img}.jpg" draggable="false"></div></div>`;
        el.addEventListener('click', e => { e.stopPropagation(); memFlip(idx); });
        el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); memFlip(idx); });
        board.appendChild(el); memCards[idx].el = el;
    });
}
function memFlip(idx) {
    const card = memCards[idx]; if (!memGameActive || memLocked || card.revealed || card.matched) return;
    card.revealed = true; card.el.classList.add('flipped'); memFlipped.push(idx);
    if (memFlipped.length === 2) {
        memLocked = true; const [a, b] = memFlipped;
        if (memCards[a].img === memCards[b].img) {
            setTimeout(() => {
                memCards[a].el.classList.add('matched'); memCards[b].el.classList.add('matched');
                memCards[a].matched = true; memCards[b].matched = true;
                memFlipped = []; memLocked = false; memMatches++;
                if (memMatches === memGetCfg().pairs) memGameOver(true);
            }, 350);
        } else {
            setTimeout(() => {
                memCards[a].revealed = false; memCards[b].revealed = false;
                memCards[a].el.classList.remove('flipped'); memCards[b].el.classList.remove('flipped');
                memFlipped = []; memLocked = false;
            }, 900);
        }
    }
}
function memGameOver(won) {
    clearInterval(memTimer); memGameActive = false;
    if (won) {
        const cfg = memGetCfg(), timeTaken = cfg.time - memTimeLeft, key = `lv${memLevel}`;
        if (!memBest[key] || timeTaken < memBest[key]) { memBest[key] = timeTaken; localStorage.setItem('mem_best', JSON.stringify(memBest)); }
        localStorage.setItem('mem_level', memLevel + 1);
    }
    $('mem-over-title').textContent = won ? '🎉 Отлично!' : '⏰ Время вышло!';
    $('mem-over-result').textContent = won ? `Уровень ${memLevel} пройден за ${memGetCfg().time - memTimeLeft}с` : `Найдено ${memMatches} из ${memGetCfg().pairs} пар`;
    $('mem-over-next').style.display = won ? 'inline-block' : 'none'; $('mem-over').classList.add('show');
    if (won) memLevel++;
}
function memUpdateBest() { const b = memBest[`lv${memLevel}`]; $('mem-best').textContent = b ? `Рекорд: ${b}с` : ''; }
['click','touchend'].forEach(evt => {
    $('mem-over-next').addEventListener(evt, e=>{ if(evt==='touchend')e.preventDefault(); e.stopPropagation(); memNewGame(); });
    $('mem-over-retry').addEventListener(evt, e=>{
        if(evt==='touchend')e.preventDefault(); e.stopPropagation();
        if($('mem-over-next').style.display !== 'none') { memLevel=Math.max(1,memLevel-1); localStorage.setItem('mem_level',memLevel); }
        memNewGame();
    });
    $('mem-restart-btn').addEventListener(evt, e=>{ if(evt==='touchend')e.preventDefault(); e.stopPropagation(); memNewGame(); });
    $('mem-reset-btn').addEventListener(evt, e=>{ if(evt==='touchend')e.preventDefault(); e.stopPropagation(); memLevel=1; localStorage.setItem('mem_level',1); memNewGame(); });
});

/* --- Flappy Bird Логика --- */
const FB_W=288, FB_H=320, FB_GROUND_H=32, FB_BIRD_X=60, FB_BIRD_R=11, FB_PIPE_W=44, FB_GAP=115, FB_SPEED=1.4, FB_GRAVITY=0.25, FB_FLAP=-5.5;
let fbState=0, fbScore=0, fbBest=parseInt(localStorage.getItem('fb_best')||'0'), fbBirdY=FB_H/2, fbBirdVY=0, fbFrame=0, fbPipes=[], fbGroundX=0, fbRAF=null, fbLastT=0;
$('fb-best').textContent=fbBest;
function fbRandGap(){ return FB_GROUND_H+40+Math.random()*(FB_H-FB_GROUND_H-FB_GAP-80); }
function fbStopLoop(){ if(fbRAF){ cancelAnimationFrame(fbRAF); fbRAF=null; } }
function fbInit(){
    fbState=0; fbScore=0; fbBirdY=FB_H/2; fbBirdVY=0; fbFrame=0; fbGroundX=0;
    fbPipes=[ {x:FB_W+60, gapY:fbRandGap(), scored:false}, {x:FB_W+220, gapY:fbRandGap(), scored:false} ];
    $('fb-score').textContent=0; $('fb-help').textContent='Click / Space to start'; fbStopLoop(); fbRAF=requestAnimationFrame(fbLoop);
}
function fbFlap(){
    if(fbState===0){ fbState=1; $('fb-help').textContent=''; } else if(fbState===1){ fbBirdVY=FB_FLAP; } else if(fbState===2){ fbInit(); }
}
function fbLoop(ts){ fbRAF=requestAnimationFrame(fbLoop); if(ts-fbLastT<25){ return; } fbLastT=ts; fbUpdate(); fbDraw(); }
function fbUpdate(){
    if(fbState!==1) return;
    fbBirdVY+=FB_GRAVITY; fbBirdY+=fbBirdVY; fbGroundX=(fbGroundX-FB_SPEED); if(fbGroundX<-20) fbGroundX=0;
    for(const p of fbPipes){
        p.x-=FB_SPEED; if(p.x+FB_PIPE_W<0){ p.x+=FB_W+FB_PIPE_W+20; p.gapY=fbRandGap(); p.scored=false; }
        if(!p.scored && p.x+FB_PIPE_W < FB_BIRD_X-FB_BIRD_R){
            p.scored=true; fbScore++; $('fb-score').textContent=fbScore;
            if(fbScore>fbBest){ fbBest=fbScore; localStorage.setItem('fb_best',fbBest); $('fb-best').textContent=fbBest; }
        }
    }
    if(fbBirdY+FB_BIRD_R>=FB_H-FB_GROUND_H || fbBirdY-FB_BIRD_R<=0){ fbDie(); return; }
    for(const p of fbPipes){
        if(FB_BIRD_X+FB_BIRD_R>p.x+4 && FB_BIRD_X-FB_BIRD_R<p.x+FB_PIPE_W-4){ if(fbBirdY-FB_BIRD_R<p.gapY || fbBirdY+FB_BIRD_R>p.gapY+FB_GAP){ fbDie(); return; } }
    }
}
function fbDie(){ fbState=2; $('fb-help').textContent='Game Over! Click to restart'; }
function fbDraw(){
    const cv=$('fb-canvas'); if(!cv) return; const cx=cv.getContext('2d');
    const sky=cx.createLinearGradient(0,0,0,FB_H-FB_GROUND_H); sky.addColorStop(0,'#4ec0ff'); sky.addColorStop(1,'#b3e5fc');
    cx.fillStyle=sky; cx.fillRect(0,0,FB_W,FB_H-FB_GROUND_H);
    cx.fillStyle='rgba(255,255,255,0.55)';
    for(const [cx2,cy2,r] of [[60,45,14],[130,30,10],[220,55,16],[30,70,8]]){
        cx.beginPath(); cx.arc(cx2,cy2,r,0,Math.PI*2); cx.fill(); cx.beginPath(); cx.arc(cx2+r*0.7,cy2,r*0.7,0,Math.PI*2); cx.fill(); cx.beginPath(); cx.arc(cx2-r*0.7,cy2,r*0.7,0,Math.PI*2); cx.fill();
    }
    for(const p of fbPipes){
        cx.fillStyle='#5cb85c'; cx.fillRect(p.x,0,FB_PIPE_W,p.gapY); cx.fillStyle='#4cae4c'; cx.fillRect(p.x-4,p.gapY-20,FB_PIPE_W+8,20); cx.fillStyle='#3d8b3d'; cx.fillRect(p.x-4,p.gapY-22,FB_PIPE_W+8,4);
        cx.fillStyle='#5cb85c'; cx.fillRect(p.x,p.gapY+FB_GAP,FB_PIPE_W,FB_H); cx.fillStyle='#4cae4c'; cx.fillRect(p.x-4,p.gapY+FB_GAP,FB_PIPE_W+8,20); cx.fillStyle='#3d8b3d'; cx.fillRect(p.x-4,p.gapY+FB_GAP+18,FB_PIPE_W+8,4);
        cx.fillStyle='rgba(255,255,255,0.15)'; cx.fillRect(p.x+4,0,8,p.gapY); cx.fillRect(p.x+4,p.gapY+FB_GAP,8,FB_H);
    }
    cx.fillStyle='#c8a84b'; cx.fillRect(0,FB_H-FB_GROUND_H,FB_W,FB_GROUND_H); cx.fillStyle='#5a9e3a'; cx.fillRect(0,FB_H-FB_GROUND_H,FB_W,8);
    cx.fillStyle='rgba(0,0,0,0.07)'; for(let gx=fbGroundX; gx<FB_W; gx+=20){ cx.fillRect(gx,FB_H-FB_GROUND_H,10,8); }
    const tilt=Math.min(Math.max(fbBirdVY*3,-30),70); cx.save(); cx.translate(FB_BIRD_X,fbBirdY); cx.rotate(tilt*Math.PI/180);
    cx.fillStyle='#f5c518'; cx.beginPath(); cx.ellipse(0,0,FB_BIRD_R,FB_BIRD_R-2,0,0,Math.PI*2); cx.fill();
    const wOff=Math.sin(fbFrame*0.25)*4; cx.fillStyle='#e6a800'; cx.beginPath(); cx.ellipse(-3,wOff,7,4,0.3,0,Math.PI*2); cx.fill();
    cx.fillStyle='#fff'; cx.beginPath(); cx.arc(5,-3,4,0,Math.PI*2); cx.fill(); cx.fillStyle='#222'; cx.beginPath(); cx.arc(6,-3,2,0,Math.PI*2); cx.fill(); cx.fillStyle='#fff'; cx.beginPath(); cx.arc(7,-4,0.8,0,Math.PI*2); cx.fill();
    cx.fillStyle='#e94560'; cx.beginPath(); cx.moveTo(FB_BIRD_R,0); cx.lineTo(FB_BIRD_R+8,-3); cx.lineTo(FB_BIRD_R+8,3); cx.closePath(); cx.fill(); cx.restore();
    if(fbState===1) fbFrame++;
    if(fbState===0){
        cx.fillStyle='rgba(0,0,0,0.32)'; cx.fillRect(0,0,FB_W,FB_H-FB_GROUND_H); cx.textAlign='center'; cx.fillStyle='#fff'; cx.font='bold 22px "Segoe UI",sans-serif';
        cx.fillText('Flappy Bird',FB_W/2,FB_H/2-18); cx.fillStyle='#ffe082'; cx.font='12px "Segoe UI",sans-serif'; cx.fillText('Click / Space to flap!',FB_W/2,FB_H/2+10);
    }
    if(fbState===2){
        cx.fillStyle='rgba(0,0,0,0.45)'; cx.fillRect(0,0,FB_W,FB_H-FB_GROUND_H); cx.textAlign='center'; cx.fillStyle='#e94560'; cx.font='bold 24px "Segoe UI",sans-serif';
        cx.fillText('Game Over!',FB_W/2,FB_H/2-28); cx.fillStyle='#fff'; cx.font='14px "Segoe UI",sans-serif'; cx.fillText('Score: '+fbScore+'   Best: '+fbBest,FB_W/2,FB_H/2+4);
        cx.fillStyle='#f5a623'; cx.font='12px "Segoe UI",sans-serif'; cx.fillText('Click to restart',FB_W/2,FB_H/2+26);
    }
}
$('fb-canvas').addEventListener('click',  e=>{ e.stopPropagation(); fbFlap(); });
$('fb-canvas').addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); fbFlap(); });


/* --- Судоку Логика --- */
const SU_CLUES = { easy: 38, medium: 30, hard: 24 };
let suDiff = localStorage.getItem('su_diff') || 'easy', suSolution = null, suPuzzle = null, suState = null, suGiven = null, suSelected = null, suErrors = 0, suTimer = 0, suTimerInt = null, suGameOver = false;
function suShuffle(arr) { const a = [...arr]; for (let i=a.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function suValid(board, r, c, n) {
    for (let i = 0; i < 9; i++) {
        if (board[r][i] === n || board[i][c] === n) return false;
        if (board[3*Math.floor(r/3) + Math.floor(i/3)][3*Math.floor(c/3) + i%3] === n) return false;
    } return true;
}
function suFill(board, rand) {
    for (let r=0; r<9; r++) for (let c=0; c<9; c++) if (!board[r][c]) {
        for (const n of rand ? suShuffle([1,2,3,4,5,6,7,8,9]) : [1,2,3,4,5,6,7,8,9]) {
            if (suValid(board, r, c, n)) { board[r][c] = n; if (suFill(board, rand)) return true; board[r][c] = 0; }
        } return false;
    } return true;
}
function suGenPuzzle(clues) {
    const sol = Array.from({length:9}, () => Array(9).fill(0)); suFill(sol, true);
    const puzzle = sol.map(r => [...r]); const cells = suShuffle([...Array(81).keys()]); let removed = 0;
    for (const idx of cells) { if (removed >= 81 - clues) break; puzzle[Math.floor(idx/9)][idx%9] = 0; removed++; }
    return { sol, puzzle };
}
function suRenderGrid() {
    const grid = $('su-grid'); if (!grid) return; grid.innerHTML = '';
    const sr = suSelected?.r, sc = suSelected?.c, sv = (sr != null) ? suState[sr][sc] : 0;
    for (let r=0; r<9; r++) for (let c=0; c<9; c++) {
        const cell = document.createElement('div'); let cls = 'su-cell';
        if (c % 3 === 0 && c > 0) cls += ' su-bl'; if (r % 3 === 0 && r > 0) cls += ' su-bt';
        if (suGiven[r][c]) { cls += ' su-given'; cell.textContent = suPuzzle[r][c]; }
        else if (suState[r][c]) { cell.textContent = suState[r][c]; if (suState[r][c] !== suSolution[r][c]) cls += ' su-wrong'; }
        if (sr != null) {
            if (r === sr && c === sc) cls += ' su-selected';
            else if (r === sr || c === sc || (Math.floor(r/3) === Math.floor(sr/3) && Math.floor(c/3) === Math.floor(sc/3))) cls += ' su-highlight';
            if (sv && suState[r][c] === sv && !(r === sr && c === sc)) cls += ' su-same-num';
        }
        cell.className = cls; cell.dataset.r = r; cell.dataset.c = c;
        if (!suGiven[r][c]) {
            cell.addEventListener('click', e=>{ e.stopPropagation(); suSelected = { r, c }; suRenderGrid(); });
            cell.addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); suSelected = { r, c }; suRenderGrid(); });
        }
        grid.appendChild(cell);
    }
}
function suBuildNumpad() {
    const pad = $('su-numpad'); if (!pad) return; pad.innerHTML = '';
    for (let n=1; n<=9; n++) {
        const btn = document.createElement('button'); btn.className = 'su-num-btn'; btn.textContent = n;
        btn.addEventListener('click', e=>{ e.stopPropagation(); suInput(n); }); btn.addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); suInput(n); });
        pad.appendChild(btn);
    }
    const eb = document.createElement('button'); eb.className = 'su-num-btn su-erase'; eb.textContent = '✕';
    eb.addEventListener('click', e=>{ e.stopPropagation(); suInput(0); }); eb.addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); suInput(0); });
    pad.appendChild(eb);
}
function suNewGame() {
    clearInterval(suTimerInt); suErrors = 0; suTimer = 0; suSelected = null; suGameOver = false;
    if ($('su-errors')) $('su-errors').textContent = '0'; if ($('su-timer')) $('su-timer').textContent = '0:00'; $('su-over')?.classList.remove('show');
    const { sol, puzzle } = suGenPuzzle(SU_CLUES[suDiff]); suSolution = sol; suPuzzle = puzzle; suState = puzzle.map(r => [...r]); suGiven = puzzle.map(r => r.map(v => v !== 0));
    suRenderGrid(); suBuildNumpad();
    sudokuPanel.querySelectorAll('.su-diff').forEach(b => b.classList.toggle('active', b.dataset.d === suDiff));
    suTimerInt = setInterval(() => {
        if (suGameOver) return; suTimer++;
        if ($('su-timer')) $('su-timer').textContent = `${Math.floor(suTimer/60)}:${(suTimer%60).toString().padStart(2,'0')}`;
    }, 1000);
}
function suInput(n) {
    if (!suSelected || suGameOver) return; const { r, c } = suSelected; if (suGiven[r][c]) return;
    if (n === 0) { suState[r][c] = 0; suRenderGrid(); return; } if (suState[r][c] === n) return; suState[r][c] = n;
    if (n !== suSolution[r][c]) {
        suErrors++; if ($('su-errors')) $('su-errors').textContent = suErrors;
        if (suErrors >= 3) { suGameOver = true; clearInterval(suTimerInt); $('su-over-title').textContent = '💀 Проигрыш!'; $('su-over-result').textContent = 'Слишком много ошибок'; suRenderGrid(); setTimeout(() => $('su-over')?.classList.add('show'), 400); return; }
    }
    suRenderGrid(); suCheckWin();
}
function suCheckWin() {
    for (let r=0; r<9; r++) for (let c=0; c<9; c++) if (suState[r][c] !== suSolution[r][c]) return;
    suGameOver = true; clearInterval(suTimerInt);
    const bKey = `su_best_${suDiff}`, prev = +localStorage.getItem(bKey) || 0; if (!prev || suTimer < prev) localStorage.setItem(bKey, suTimer);
    const best = +localStorage.getItem(bKey);
    $('su-over-title').textContent = '🎉 Победа!'; $('su-over-result').textContent = `Время: ${Math.floor(suTimer/60)}:${(suTimer%60).toString().padStart(2,'0')} · Рекорд: ${Math.floor(best/60)}:${(best%60).toString().padStart(2,'0')}`;
    setTimeout(() => $('su-over')?.classList.add('show'), 300);
}
$('su-again').addEventListener('click', e=>{ e.stopPropagation(); suNewGame(); });
$('su-again').addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); suNewGame(); });
sudokuPanel.querySelectorAll('.su-diff').forEach(b => {
    b.addEventListener('click', e => { e.stopPropagation(); suDiff = b.dataset.d; localStorage.setItem('su_diff', suDiff); suNewGame(); });
});
/* ═══════════════════════════════════════
   ЕДИНЫЙ ОБРАБОТЧИК КЛАВИШ
   — блокирует стрелки от SillyTavern пока открыта любая игра
═══════════════════════════════════════ */
document.addEventListener('keydown', e => {
    const anyOpen = panelOpen || msPanelOpen || panel2048Open || memPanelOpen ||
                    mjPanelOpen || flappyPanelOpen || sudokuPanelOpen;
    if (!anyOpen) return;

    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
                    e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    const isSpace = e.key === ' ' || e.code === 'Space';

    // Стрелки и пробел ВСЕГДА блокируем от SillyTavern пока открыта игра
    if (isArrow || isSpace) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    }

    /* --- 2048: стрелки = ходы --- */
    if (panel2048Open) {
        const dir = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down' }[e.key];
        if (dir) g2048Move(dir);
        return;
    }

    /* --- Flappy Bird: пробел / стрелка вверх = прыжок --- */
    if (flappyPanelOpen) {
        if (isSpace || e.key === 'ArrowUp') fbFlap();
        return;
    }

    /* --- Судоку: стрелки = навигация по ячейкам, цифры = ввод --- */
    if (sudokuPanelOpen && !suGameOver) {
        const key = e.key;
        if (key >= '1' && key <= '9') { e.stopPropagation(); suInput(+key); return; }
        if (key === 'Backspace' || key === 'Delete' || key === '0') { e.stopPropagation(); suInput(0); return; }
        if (!suSelected) return;
        let { r, c } = suSelected;
        if      (key === 'ArrowUp'    && r > 0) r--;
        else if (key === 'ArrowDown'  && r < 8) r++;
        else if (key === 'ArrowLeft'  && c > 0) c--;
        else if (key === 'ArrowRight' && c < 8) c++;
        else return;
        if (!suGiven[r][c]) { suSelected = { r, c }; suRenderGrid(); }
        return;
    }

    /* --- Сапёр: стрелки = навигация по полю --- */
    if (msPanelOpen && msStarted && !msDead && !msWon) {
        if (!isArrow) return;
        const cfg = MS_CFG[msDiff];
        // Ищем текущую выбранную ячейку или берём первую открытую
        let cur = document.querySelector('.ms-cell.kb-focus');
        let r = cur ? +cur.dataset.r : 0;
        let c = cur ? +cur.dataset.c : 0;
        if (e.key === 'ArrowUp'    && r > 0) r--;
        else if (e.key === 'ArrowDown'  && r < cfg.rows-1) r++;
        else if (e.key === 'ArrowLeft'  && c > 0) c--;
        else if (e.key === 'ArrowRight' && c < cfg.cols-1) c++;
        document.querySelectorAll('.ms-cell.kb-focus').forEach(el => el.classList.remove('kb-focus'));
        const next = document.querySelector('.ms-cell[data-r="'+r+'"][data-c="'+c+'"]' );
        if (next) next.classList.add('kb-focus');
        return;
    }
}, true); // capture:true — перехватываем ДО SillyTavern

// Init
if (enabledGames.has(currentGame)) lazyInitGame(currentGame);
console.log('🎮 [Games] v6.1 — Добавлен Маджонг!');

/* ═══════════════════════════════════════
   ПУБЛИЧНОЕ API для календаря
═══════════════════════════════════════ */
window.GameCollection = {
    list: ALL_GAMES,
    get enabled() { return [...enabledGames]; },
    open(id) {
        if (!id) return false;
        const known = ALL_GAMES.some(g => g.id === id);
        if (!known) return false;
        currentGame = id;
        try { localStorage.setItem('bb_game', id); } catch (_) {}
        // На всякий случай добавим в enabled, если выключена
        if (!enabledGames.has(id)) {
            enabledGames.add(id);
            try { saveEnabledGames(); } catch (_) {}
        }
        openCurrentGame();
        return true;
    },
    close() { try { closePanels(); closePicker(); } catch (_) {} },
    showPicker() { try { showPicker(); } catch (_) {} },
};
