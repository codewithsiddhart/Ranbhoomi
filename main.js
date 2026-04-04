const TIMER_BUDGET_SEC = 600;

const GAME = {
  size: 10,
  activePlayer: 1,
  winner: null,
  mode: "local",
  scenario: "opening",
  fogEnabled: false,
  selectedUnitId: null,
  units: [],
  terrain: {},
  mudTiles: {},
  lastAction: "-",
  actionLog: [],
  cardUsedThisTurn: false,
  pendingCard: null,
  cardStep: null,
  strikeBuffByPlayer: { 1: false, 2: false },
  guardByUnitId: {},
  cardsByPlayer: {
    1: { strike: 2, guard: 2, reposition: 2 },
    2: { strike: 2, guard: 2, reposition: 2 },
  },
  animations: { attackerId: null, targetId: null, archerImpact: null, movedUnitId: null },
  /** @type {{ x: number; y: number; text: string; absorbed: boolean } | null} */
  damagePopup: null,
  selectedScenarioLabel: "Opening Formation",
  momentumByUnitId: {},
  turnEventMessage: null,
  turnCombatBonus: { archer: 0, melee: 0 },
  firstStrikeBonusPandav: 0,
  /** Which player (1 or 2) commands the Pandav host; the other is Kaurav. */
  pandavPlayer: 1,
  timerEnabled: true,
  timerSecondsLeft: { 1: TIMER_BUDGET_SEC, 2: TIMER_BUDGET_SEC },
};

const UNIT_DEFS = {
  L: { name: "Leader", move: 1, hp: 10, damage: 3, melee: true, archerRange: null },
  I: { name: "Infantry", move: 1, hp: 6, damage: 2, melee: true, archerRange: null },
  A: { name: "Archer", move: 1, hp: 4, damage: 2, melee: false, archerRange: [2, 3] },
  C: { name: "Cavalry", move: 2, hp: 6, damage: 3, melee: true, archerRange: null },
  E: { name: "Elephant", move: 1, hp: 9, damage: 4, melee: true, archerRange: null },
  R: { name: "Chariot", move: 2, hp: 7, damage: 3, melee: true, archerRange: null },
};

/** Photoreal unit art (local JPEGs); SVG used on load error. */
const UNIT_IMAGE_BY_TYPE = {
  L: "assets/units/leader.jpg",
  I: "assets/units/infantry.jpg",
  A: "assets/units/archer.jpg",
  C: "assets/units/cavalry.jpg",
  E: "assets/units/elephant.jpg",
  R: "assets/units/chariot.jpg",
};
const UNIT_IMAGE_FALLBACK_SVG = {
  L: "sprites/unit_leader.svg",
  I: "sprites/unit_infantry.svg",
  A: "sprites/unit_archer.svg",
  C: "sprites/unit_cavalry.svg",
  E: "sprites/unit_elephant.svg",
  R: "sprites/unit_chariot.svg",
};

const LOG_ICON = {
  move: "🧭",
  attack: "⚔️",
  hit: "💥",
  card: "🎴",
  event: "🌪️",
  morale: "✨",
  leader: "👑",
  terrain: "🗺️",
  turn: "🔁",
  info: "📜",
  cheer: "🎖️",
  magic: "✨",
};
const SCENARIO_PREVIEW_META = {
  opening: {
    title: "Battlefield Recon: Opening Formation",
    desc: "Balanced frontline lanes with stable terrain and broad maneuver options.",
  },
  frontline: {
    title: "Battlefield Recon: Frontline Clash",
    desc: "Heavy center pressure and direct infantry collision from turn one.",
  },
  flanks: {
    title: "Battlefield Recon: Flank Pressure",
    desc: "Wide side lanes favor cavalry loops, pincer strikes, and backline raids.",
  },
  "leader-hunt": {
    title: "Battlefield Recon: Leader Hunt",
    desc: "Tight central choke points reward precision attacks on command units.",
  },
  "forest-ambush": {
    title: "Battlefield Recon: Forest Ambush",
    desc: "Green cover and concealed approach lanes punish careless advances.",
  },
  "royal-siege": {
    title: "Battlefield Recon: Royal Siege",
    desc: "Fortified centerline and siege lane create a brutal high-stakes push.",
  },
};

let cellMap = [];
/** @type {ReturnType<typeof setTimeout> | null} */
let aiTurnTimeoutId = null;
/** @type {ReturnType<typeof setInterval> | null} */
let chessTimerIntervalId = null;
let boardEl;
let currentPlayerLabel;
let turnBannerEl;
let winnerLabel;
let lastActionEl;
let actionLogEl;
let rulesBtn;
let resetBtn;
let rulesDialogEl;
let closeRulesBtn;
let modeSelectEl;
let fogToggleEl;
let phaseStateEl;
let bonusStateEl;
let cardsStateEl;
let homeScreenEl;
let gameScreenEl;
let goToBattleBtn;
let backHomeBtn;
let scenarioCardsEl;
let ambientAudioCtx;
let themeSelectEl;
let battleMapPreviewEl;
let battlePreviewTitleEl;
let battlePreviewDescEl;
let momentumStateEl;
let eventBannerEl;
let toastEl;
let sideSelectEl;
let aiSideWrapEl;
let clockP1El;
let clockP2El;
let clockP1Wrap;
let clockP2Wrap;
let timerToggleBtn;
let playLocalBtnEl;
let playAiBtnEl;
let homeSettingsBtnEl;
let settingsDialogEl;
let closeSettingsBtnEl;
let settingsApplyBtnEl;
let settingsThemeEl;
let settingsModeEl;
let settingsTimerEl;
let settingsFogEl;

function posKey(x, y) {
  return `${x}-${y}`;
}

function getLeader(player) {
  return GAME.units.find((u) => u.player === player && u.type === "L") || null;
}

function kauravPlayerNum() {
  return GAME.pandavPlayer === 1 ? 2 : 1;
}

function factionName(player) {
  return player === GAME.pandavPlayer ? "Pandav" : "Kaurav";
}

function getMoraleDamageBonus(attacker) {
  if (attacker.player !== GAME.pandavPlayer) return 0;
  const leader = getLeader(GAME.pandavPlayer);
  if (!leader) return 0;
  return maxDiagDistance(attacker.position.x, attacker.position.y, leader.position.x, leader.position.y) <= 2 ? 1 : 0;
}

function getIntimidationMovePenalty(unit) {
  if (unit.player !== GAME.pandavPlayer) return 0;
  const kaurav = getLeader(kauravPlayerNum());
  if (!kaurav) return 0;
  return maxDiagDistance(unit.position.x, unit.position.y, kaurav.position.x, kaurav.position.y) <= 1 ? 1 : 0;
}

function getEffectiveMove(unit) {
  let m = UNIT_DEFS[unit.type].move;
  m -= getIntimidationMovePenalty(unit);
  if (GAME.mudTiles[posKey(unit.position.x, unit.position.y)]) m -= 1;
  if (unit.player === GAME.activePlayer) {
    m -= GAME.turnCombatBonus.movePenalty || 0;
    if (unit.type === "C" || unit.type === "R") m += GAME.turnCombatBonus.cavalryMove || 0;
  }
  return Math.max(1, m);
}

function canOccupyTerrain(unit, x, y) {
  const t = getTerrainAt(x, y);
  if (t === "river" && unit.type !== "C" && unit.type !== "R") return false;
  return true;
}

function getMomentumBonus(attacker) {
  const st = GAME.momentumByUnitId[attacker.id];
  if (!st || st.count < 2) return 0;
  return 1;
}

function bumpMomentum(unit, kind) {
  const prev = GAME.momentumByUnitId[unit.id] || { count: 0, kind: null };
  if (prev.kind === kind) prev.count += 1;
  else {
    prev.count = 1;
    prev.kind = kind;
  }
  GAME.momentumByUnitId[unit.id] = prev;
}

function clearMomentum(unitId) {
  delete GAME.momentumByUnitId[unitId];
}

function countThreatsAgainst(unit) {
  let n = 0;
  const viewer = unit.player;
  for (const other of GAME.units) {
    if (!other || other.player === unit.player) continue;
    if (GAME.fogEnabled && !isVisibleToPlayer(other.position.x, other.position.y, viewer)) continue;
    if (canAttack(other, unit)) n += 1;
  }
  return n;
}

function hpTier(unit) {
  const maxHp = UNIT_DEFS[unit.type].hp;
  const ratio = unit.hp / maxHp;
  if (ratio <= 0.35) return "low";
  if (ratio <= 0.65) return "mid";
  return "high";
}

function readHomeBonus() {
  try {
    const raw = sessionStorage.getItem("ranbhoomiHomeBonus");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function consumeHomeBonus() {
  const b = readHomeBonus();
  if (!b || !b.strike) return false;
  sessionStorage.removeItem("ranbhoomiHomeBonus");
  return true;
}

function showToast(message, ms = 2600) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => toastEl.classList.remove("visible"), ms);
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  if (!clockP1El || !clockP2El) return;
  if (!GAME.timerEnabled) {
    clockP1El.textContent = "—";
    clockP2El.textContent = "—";
    clockP1Wrap?.classList.remove("clock-active");
    clockP2Wrap?.classList.remove("clock-active");
    return;
  }
  clockP1El.textContent = formatClock(GAME.timerSecondsLeft[1]);
  clockP2El.textContent = formatClock(GAME.timerSecondsLeft[2]);
  clockP1Wrap?.classList.toggle("clock-active", GAME.activePlayer === 1 && !GAME.winner);
  clockP2Wrap?.classList.toggle("clock-active", GAME.activePlayer === 2 && !GAME.winner);
}

function stopChessTimer() {
  if (chessTimerIntervalId != null) {
    window.clearInterval(chessTimerIntervalId);
    chessTimerIntervalId = null;
  }
}

function startChessTimer() {
  stopChessTimer();
  if (!GAME.timerEnabled) return;
  chessTimerIntervalId = window.setInterval(() => {
    if (GAME.winner || !gameScreenEl || gameScreenEl.classList.contains("hidden")) return;
    const p = GAME.activePlayer;
    GAME.timerSecondsLeft[p] = Math.max(0, GAME.timerSecondsLeft[p] - 1);
    if (GAME.timerSecondsLeft[p] <= 0) {
      const loser = p;
      GAME.winner = loser === 1 ? 2 : 1;
      stopChessTimer();
      showToast(`${playerLabel(loser)} ran out of time — ${factionName(GAME.winner)} wins.`, 4200);
      addLog({ icon: LOG_ICON.event, text: `${playerLabel(loser)}'s hourglass ran out.` });
      rerender();
      return;
    }
    updateTimerDisplay();
  }, 1000);
}

function onTurnStart() {
  GAME.turnEventMessage = null;
  GAME.turnCombatBonus = {
    archer: 0,
    melee: 0,
    allDamage: 0,
    leaderDamage: 0,
    chargeDamage: 0,
    movePenalty: 0,
    cavalryMove: 0,
  };
  if (GAME.winner) return;
  if (Math.random() < 0.32) {
    const rolls = [
      { w: 11, fn: () => {
          GAME.turnCombatBonus.archer = 1;
          return "Sudden wind — your archers strike truer (+1 archer damage this turn).";
        } },
      { w: 11, fn: () => {
          GAME.turnCombatBonus.melee = -1;
          return "Churned mud — melee slips (−1 melee damage this turn).";
        } },
      { w: 8, fn: () => {
          GAME.turnCombatBonus.melee = 1;
          return "Agni’s spark — blades bite deeper (+1 melee damage this turn).";
        } },
      { w: 7, fn: () => {
          GAME.turnCombatBonus.archer = -1;
          return "Surya’s glare — sun in the eyes (−1 archer damage this turn).";
        } },
      { w: 7, fn: () => {
          GAME.turnCombatBonus.allDamage = 1;
          return "War drums — the line surges (+1 to all damage you deal this turn).";
        } },
      { w: 7, fn: () => {
          GAME.turnCombatBonus.leaderDamage = 1;
          return "Ancestors whisper — your Leader fights sharper (+1 Leader damage this turn).";
        } },
      { w: 6, fn: () => {
          GAME.turnCombatBonus.chargeDamage = 1;
          return "Open ground — riders charge true (+1 Cavalry & Chariot damage this turn).";
        } },
      { w: 6, fn: () => {
          GAME.turnCombatBonus.cavalryMove = 1;
          return "Ashwins’ favor — horses fly (+1 move for Cavalry & Chariot this turn).";
        } },
      { w: 5, fn: () => {
          GAME.turnCombatBonus.movePenalty = 1;
          return "Earth tremor — footing fails (−1 move for your army this turn, minimum 1).";
        } },
      { w: 9, fn: () => {
          for (const u of GAME.units) {
            if (u.player === GAME.activePlayer) {
              u.hp = Math.min(UNIT_DEFS[u.type].hp, u.hp + 1);
            }
          }
          return "Healing dew — the field remembers your oath (all your units +1 HP, to max).";
        } },
      { w: 5, fn: () => "Dead calm — no omen; rely on steel and order." },
      { w: 4, fn: () => {
          GAME.turnCombatBonus.archer = 1;
          GAME.turnCombatBonus.melee = 1;
          return "Twin omens — wind and dust favor both blade and bow (+1 melee & archer this turn).";
        } },
    ];
    let sum = 0;
    for (const r of rolls) sum += r.w;
    let t = Math.random() * sum;
    for (const r of rolls) {
      t -= r.w;
      if (t <= 0) {
        GAME.turnEventMessage = r.fn();
        break;
      }
    }
    if (GAME.turnEventMessage) {
      addLog({ icon: LOG_ICON.magic, text: GAME.turnEventMessage });
      playFx("magic");
      if (gameScreenEl) {
        gameScreenEl.classList.remove("magic-surge");
        void gameScreenEl.offsetWidth;
        gameScreenEl.classList.add("magic-surge");
        window.setTimeout(() => gameScreenEl.classList.remove("magic-surge"), 1100);
      }
    }
  }
  if (eventBannerEl) {
    eventBannerEl.textContent = GAME.turnEventMessage || "Field clear — command your line.";
  }
}

function withinGrid(x, y) {
  return x >= 0 && x < GAME.size && y >= 0 && y < GAME.size;
}

function getUnitAt(x, y) {
  return GAME.units.find((u) => u.position.x === x && u.position.y === y) || null;
}

function isEmpty(x, y) {
  return !getUnitAt(x, y);
}

function maxDiagDistance(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

function playerLabel(player) {
  return `${factionName(player)} (P${player})`;
}

function addLog(lineOrEntry) {
  const entry =
    typeof lineOrEntry === "string"
      ? { icon: LOG_ICON.info, text: lineOrEntry }
      : { icon: lineOrEntry.icon || LOG_ICON.info, text: lineOrEntry.text };
  const line = `${entry.icon} ${entry.text}`;
  GAME.lastAction = line;
  GAME.actionLog.unshift(entry);
  GAME.actionLog = GAME.actionLog.slice(0, 16);
  lastActionEl.textContent = line;
  actionLogEl.innerHTML = "";
  for (const item of GAME.actionLog) {
    const li = document.createElement("li");
    li.className = "log-row";
    const ic = document.createElement("span");
    ic.className = "log-icon";
    ic.setAttribute("aria-hidden", "true");
    ic.textContent = item.icon || LOG_ICON.info;
    const tx = document.createElement("span");
    tx.className = "log-text";
    tx.textContent = item.text;
    li.appendChild(ic);
    li.appendChild(tx);
    actionLogEl.appendChild(li);
  }
}

function applyTheme(themeName) {
  document.body.classList.remove("theme-kurukshetra", "theme-royal", "theme-forest", "theme-sunset");
  const t = themeName || "kurukshetra";
  if (t === "kurukshetra") document.body.classList.add("theme-kurukshetra");
  else document.body.classList.add(`theme-${t}`);
}

function playFx(kind) {
  try {
    ambientAudioCtx = ambientAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = ambientAudioCtx.currentTime;
    const osc = ambientAudioCtx.createOscillator();
    const gain = ambientAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(ambientAudioCtx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    if (kind === "select") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, now);
      gain.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
      return;
    }
    if (kind === "move") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.11);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
      return;
    }
    if (kind === "archer") {
      osc.type = "square";
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.exponentialRampToValueAtTime(250, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
      return;
    }
    if (kind === "magic") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
      return;
    }
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (_) {
    // Keep gameplay intact if audio is blocked.
  }
}

function getTerrainAt(x, y) {
  return GAME.terrain[posKey(x, y)] || null;
}

function isVisibleToPlayer(x, y, player) {
  if (!GAME.fogEnabled) return true;
  const vision = 2;
  return GAME.units.some(
    (u) => u.player === player && maxDiagDistance(u.position.x, u.position.y, x, y) <= vision
  );
}

function getFormationBonusForPlayer(player) {
  let lineActive = false;
  for (const u of GAME.units) {
    if (u.player !== player || u.type !== "I") continue;
    const right = getUnitAt(u.position.x + 1, u.position.y);
    const left = getUnitAt(u.position.x - 1, u.position.y);
    const up = getUnitAt(u.position.x, u.position.y - 1);
    const down = getUnitAt(u.position.x, u.position.y + 1);
    const hasRow = right && left && right.player === player && left.player === player;
    const hasCol = up && down && up.player === player && down.player === player;
    if (hasRow || hasCol) {
      lineActive = true;
      break;
    }
  }
  return { line: lineActive ? 1 : 0 };
}

function getSurroundBonus(attacker, target) {
  const around = [
    [target.position.x + 1, target.position.y],
    [target.position.x - 1, target.position.y],
    [target.position.x, target.position.y + 1],
    [target.position.x, target.position.y - 1],
  ];
  const alliesNear = around
    .map(([x, y]) => getUnitAt(x, y))
    .filter((u) => u && u.player === attacker.player).length;
  return alliesNear >= 2 ? 1 : 0;
}

function movementTargets(unit) {
  const moveDist = getEffectiveMove(unit);
  const out = [];
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      if (!isEmpty(x, y)) continue;
      if (!canOccupyTerrain(unit, x, y)) continue;
      if (maxDiagDistance(unit.position.x, unit.position.y, x, y) === moveDist) out.push({ x, y });
    }
  }
  return out;
}

function canMoveTo(unit, x, y) {
  if (!withinGrid(x, y) || !isEmpty(x, y)) return false;
  if (!canOccupyTerrain(unit, x, y)) return false;
  return maxDiagDistance(unit.position.x, unit.position.y, x, y) === getEffectiveMove(unit);
}

function canAttack(attacker, target) {
  if (!attacker || !target || attacker.player === target.player) return false;
  const def = UNIT_DEFS[attacker.type];
  const d = maxDiagDistance(attacker.position.x, attacker.position.y, target.position.x, target.position.y);
  if (def.melee) return d === 1;
  if (def.archerRange) return d >= def.archerRange[0] && d <= def.archerRange[1];
  return false;
}

function attackTargets(unit) {
  return GAME.units.filter((other) => {
    if (!canAttack(unit, other)) return false;
    if (GAME.fogEnabled && other.player !== unit.player) {
      if (!isVisibleToPlayer(other.position.x, other.position.y, unit.player)) return false;
    }
    return true;
  });
}

function computeDamage(attacker, target) {
  const base = UNIT_DEFS[attacker.type].damage;
  const lineBonus = getFormationBonusForPlayer(attacker.player).line;
  const surroundBonus = getSurroundBonus(attacker, target);
  const strikeBonus = GAME.strikeBuffByPlayer[attacker.player] ? 2 : 0;
  const hillBonus =
    getTerrainAt(attacker.position.x, attacker.position.y) === "hill" && attacker.type === "A" ? 1 : 0;
  const forestShield =
    getTerrainAt(target.position.x, target.position.y) === "forest" && attacker.type === "A" ? 1 : 0;
  const moraleBonus = getMoraleDamageBonus(attacker);
  const momentumBonus = getMomentumBonus(attacker);
  const homeBonus = attacker.player === GAME.pandavPlayer && GAME.firstStrikeBonusPandav > 0 ? 1 : 0;
  const isMelee = UNIT_DEFS[attacker.type].melee;
  const riverPenalty =
    getTerrainAt(attacker.position.x, attacker.position.y) === "river" && isMelee ? 1 : 0;
  let eventArcher = 0;
  let eventMelee = 0;
  let eventExtra = 0;
  if (attacker.player === GAME.activePlayer) {
    if (attacker.type === "A") eventArcher += GAME.turnCombatBonus.archer;
    if (isMelee) eventMelee += GAME.turnCombatBonus.melee;
    eventExtra += GAME.turnCombatBonus.allDamage;
    if (attacker.type === "L") eventExtra += GAME.turnCombatBonus.leaderDamage;
    if (attacker.type === "C" || attacker.type === "R") eventExtra += GAME.turnCombatBonus.chargeDamage;
  }
  let total =
    base +
    lineBonus +
    surroundBonus +
    strikeBonus +
    hillBonus -
    forestShield +
    moraleBonus +
    momentumBonus +
    homeBonus +
    eventArcher +
    eventMelee +
    eventExtra -
    riverPenalty;
  total = Math.max(1, total);
  return total;
}

function checkWin() {
  const p1Leader = GAME.units.find((u) => u.player === 1 && u.type === "L");
  const p2Leader = GAME.units.find((u) => u.player === 2 && u.type === "L");
  if (!p1Leader) return 2;
  if (!p2Leader) return 1;
  const p1Units = GAME.units.some((u) => u.player === 1);
  const p2Units = GAME.units.some((u) => u.player === 2);
  if (!p1Units) return 2;
  if (!p2Units) return 1;
  return null;
}

function clearHighlights() {
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      cellMap[y][x].classList.remove(
        "selected",
        "move-target",
        "attack-target",
        "attack-hit",
        "fog-hidden",
        "intimidation-zone",
        "morale-aura"
      );
    }
  }
}

function highlightState() {
  clearHighlights();
  const pandav = getLeader(GAME.pandavPlayer);
  if (pandav && (!GAME.fogEnabled || isVisibleToPlayer(pandav.position.x, pandav.position.y, GAME.activePlayer))) {
    for (let y = 0; y < GAME.size; y++) {
      for (let x = 0; x < GAME.size; x++) {
        if (GAME.fogEnabled && !isVisibleToPlayer(x, y, GAME.activePlayer)) continue;
        if (maxDiagDistance(x, y, pandav.position.x, pandav.position.y) <= 2) {
          cellMap[y][x].classList.add("morale-aura");
        }
      }
    }
  }
  const kaurav = getLeader(kauravPlayerNum());
  if (kaurav && (!GAME.fogEnabled || isVisibleToPlayer(kaurav.position.x, kaurav.position.y, GAME.activePlayer))) {
    for (let y = 0; y < GAME.size; y++) {
      for (let x = 0; x < GAME.size; x++) {
        if (GAME.fogEnabled && !isVisibleToPlayer(x, y, GAME.activePlayer)) continue;
        if (maxDiagDistance(x, y, kaurav.position.x, kaurav.position.y) === 1) {
          cellMap[y][x].classList.add("intimidation-zone");
        }
      }
    }
  }
  const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
  if (selected) {
    cellMap[selected.position.y][selected.position.x].classList.add("selected");
    for (const t of movementTargets(selected)) cellMap[t.y][t.x].classList.add("move-target");
    for (const t of attackTargets(selected)) cellMap[t.position.y][t.position.x].classList.add("attack-target");
  }
  if (GAME.fogEnabled) {
    for (let y = 0; y < GAME.size; y++) {
      for (let x = 0; x < GAME.size; x++) {
        if (!isVisibleToPlayer(x, y, GAME.activePlayer)) cellMap[y][x].classList.add("fog-hidden");
      }
    }
  }
}

function cellTerrainTitle(x, y) {
  const parts = [];
  const terrain = getTerrainAt(x, y);
  if (terrain === "forest") parts.push("Forest — archers deal less damage to targets here");
  if (terrain === "hill") parts.push("Hill — archers standing here gain +1 damage");
  if (terrain === "river") parts.push("River — only cavalry & chariots may stand here; melee from river is weaker");
  if (GAME.mudTiles[posKey(x, y)]) parts.push("Mud — movement from this tile is reduced by 1");
  if (!parts.length) parts.push("Open ground");
  return parts.join(". ") + ".";
}

function renderBoardCells() {
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      const cell = cellMap[y][x];
      cell.innerHTML = "";
      cell.style.removeProperty("--arrow-angle");
      cell.classList.remove("terrain-forest", "terrain-hill", "terrain-river", "terrain-mud");
      const terrain = getTerrainAt(x, y);
      if (terrain === "forest") cell.classList.add("terrain-forest");
      if (terrain === "hill") cell.classList.add("terrain-hill");
      if (terrain === "river") cell.classList.add("terrain-river");
      if (GAME.mudTiles[posKey(x, y)]) cell.classList.add("terrain-mud");
      cell.title = cellTerrainTitle(x, y);
    }
  }
  for (const u of GAME.units) {
    const hidden = GAME.fogEnabled && u.player !== GAME.activePlayer && !isVisibleToPlayer(u.position.x, u.position.y, GAME.activePlayer);
    if (hidden) continue;
    const cell = cellMap[u.position.y][u.position.x];
    const unitEl = document.createElement("div");
    const fac = u.player === GAME.pandavPlayer ? "pandav" : "kaurav";
    unitEl.className = `unit ${fac}`;
    unitEl.classList.add(`hp-${hpTier(u)}`);
    const mom = GAME.momentumByUnitId[u.id];
    if (mom && mom.count >= 2) unitEl.classList.add("unit-momentum");
    if (getMoraleDamageBonus(u) > 0) unitEl.classList.add("unit-morale");
    if (countThreatsAgainst(u) > 0) unitEl.classList.add("unit-threat");
    if (GAME.animations.attackerId === u.id) unitEl.classList.add("anim-attack");
    if (GAME.animations.targetId === u.id) unitEl.classList.add("anim-hit");
    if (GAME.animations.movedUnitId === u.id) unitEl.classList.add("anim-move-hop");
    const letter = document.createElement("div");
    letter.className = "letter";
    if (u.type === "L" && u.hp <= Math.ceil(UNIT_DEFS.L.hp / 2)) letter.classList.add("ability-ready");
    const img = document.createElement("img");
    img.className = "unit-sprite";
    img.src = UNIT_IMAGE_BY_TYPE[u.type] || UNIT_IMAGE_FALLBACK_SVG[u.type];
    img.alt = UNIT_DEFS[u.type].name;
    img.decoding = "async";
    img.loading = "lazy";
    img.onerror = () => {
      img.onerror = null;
      img.src = UNIT_IMAGE_FALLBACK_SVG[u.type] || "sprites/unit_infantry.svg";
    };
    letter.appendChild(img);
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = UNIT_DEFS[u.type].name;
    const maxHp = UNIT_DEFS[u.type].hp;
    const pct = Math.max(0, Math.min(100, Math.round((100 * u.hp) / maxHp)));
    const meta = document.createElement("div");
    meta.className = "unit-meta";
    const hpWrap = document.createElement("div");
    hpWrap.className = "unit-hp-wrap";
    hpWrap.title = `HP ${u.hp} / ${maxHp}`;
    const hpFill = document.createElement("div");
    hpFill.className = "unit-hp-fill";
    hpFill.style.width = `${pct}%`;
    hpWrap.appendChild(hpFill);
    meta.appendChild(hpWrap);
    const tags = document.createElement("div");
    tags.className = "unit-tags";
    if (GAME.guardByUnitId[u.id]) {
      const g = document.createElement("span");
      g.className = "unit-tag unit-tag-guard";
      g.textContent = "G";
      g.title = "Guard — absorbs incoming damage";
      tags.appendChild(g);
    }
    if (mom && mom.count >= 1) {
      const m = document.createElement("span");
      m.className = "unit-tag unit-tag-mom";
      m.textContent = `M${mom.count}`;
      m.title = "Momentum streak";
      tags.appendChild(m);
    }
    if (tags.childNodes.length) meta.appendChild(tags);
    unitEl.appendChild(letter);
    unitEl.appendChild(name);
    unitEl.appendChild(meta);
    cell.appendChild(unitEl);
  }
  if (GAME.animations.archerImpact) {
    const { x, y, angle } = GAME.animations.archerImpact;
    const c = cellMap[y][x];
    c.classList.add("archer-trail");
    if (typeof angle === "number") c.style.setProperty("--arrow-angle", `${angle}deg`);
  }
  if (GAME.damagePopup) {
    const { x, y, text, absorbed } = GAME.damagePopup;
    const cell = cellMap[y][x];
    const pop = document.createElement("span");
    pop.className = absorbed ? "damage-popup damage-popup-guard" : "damage-popup";
    pop.textContent = absorbed ? text : `-${text}`;
    cell.appendChild(pop);
  }
}

function renderStatus() {
  currentPlayerLabel.textContent = playerLabel(GAME.activePlayer);
  turnBannerEl.classList.remove("p1", "p2", "turn-pandav", "turn-kaurav");
  turnBannerEl.classList.add(GAME.activePlayer === 1 ? "p1" : "p2");
  turnBannerEl.classList.add(GAME.activePlayer === GAME.pandavPlayer ? "turn-pandav" : "turn-kaurav");
  if (GAME.winner) {
    turnBannerEl.classList.add("hidden");
    winnerLabel.classList.remove("hidden");
    winnerLabel.textContent = `${factionName(GAME.winner)} host (${GAME.winner === 1 ? "P1" : "P2"}) wins the war.`;
  } else {
    turnBannerEl.classList.remove("hidden");
    winnerLabel.classList.add("hidden");
  }
  const modeStr =
    GAME.mode === "ai"
      ? `You vs AI — you: ${factionName(1)} (P1) · AI: ${factionName(2)} (P2)`
      : `Local — ${factionName(1)} = P1, ${factionName(2)} = P2 (random each match)`;
  phaseStateEl.textContent = `Scenario: ${GAME.selectedScenarioLabel} | ${modeStr} | fog optional`;
  const p1Line = getFormationBonusForPlayer(1).line ? "ON" : "OFF";
  const p2Line = getFormationBonusForPlayer(2).line ? "ON" : "OFF";
  bonusStateEl.textContent = `Line P1 ${p1Line} / P2 ${p2Line}. Pandav morale near Pandav leader; Kaurav fear near Kaurav leader. Rivers & mud as marked.`;
  if (momentumStateEl) {
    const sel = GAME.units.find((u) => u.id === GAME.selectedUnitId);
    if (sel) {
      const m = GAME.momentumByUnitId[sel.id];
      momentumStateEl.textContent = m
        ? `Momentum: ${m.count} (${m.kind}) — at 2+ gain +1 damage on attacks.`
        : "Momentum: move resets streak; chain attacks or survive hits to build it.";
    } else {
      momentumStateEl.textContent = "Select a unit to preview its momentum.";
    }
  }
  cardsStateEl.innerHTML = renderCardsUI();
  updateTimerDisplay();
}

function renderCardsUI() {
  const p = GAME.activePlayer;
  const c = GAME.cardsByPlayer[p];
  const used = GAME.cardUsedThisTurn;
  const fac = factionName(p);
  const strikeDisabled = c.strike < 1 || used ? "disabled" : "";
  const guardDisabled  = c.guard  < 1 || used ? "disabled" : "";
  const reposDisabled  = c.reposition < 1 || used ? "disabled" : "";
  const pending = GAME.pendingCard;
  return `
    <div class="card-player-label">⚜ ${fac} War Cards · ${used ? "Card used this turn" : "One use per turn"}</div>
    <div class="cards-wrap">
      <button class="card-btn${c.strike < 1 ? " card-depleted" : ""}" data-card="strike" ${strikeDisabled} title="Empower next attack with +2 damage">
        <span class="card-glyph">⚡</span>
        <span class="card-name">Strike</span>
        <span class="card-rule">Next attack +2 damage</span>
        <span class="card-charges">${c.strike}</span>
      </button>
      <button class="card-btn${c.guard < 1 ? " card-depleted" : ""}" data-card="guard" ${guardDisabled} title="Shield a friendly unit to absorb incoming damage">
        <span class="card-glyph">🛡️</span>
        <span class="card-name">Guard</span>
        <span class="card-rule">Shield ally from damage</span>
        <span class="card-charges">${c.guard}</span>
      </button>
      <button class="card-btn${c.reposition < 1 ? " card-depleted" : ""}" data-card="reposition" ${reposDisabled} title="Instantly move a friendly unit up to 2 tiles">
        <span class="card-glyph">💨</span>
        <span class="card-name">Reposition</span>
        <span class="card-rule">Move ally up to 2 tiles</span>
        <span class="card-charges">${c.reposition}</span>
      </button>
    </div>
    ${pending ? `<div class="card-pending-hint">✦ Active: ${pending} — click a target on the board</div>` : ""}
  `;
}

function switchTurn() {
  GAME.activePlayer = GAME.activePlayer === 1 ? 2 : 1;
  GAME.selectedUnitId = null;
  GAME.pendingCard = null;
  GAME.cardStep = null;
  GAME.cardUsedThisTurn = false;
  onTurnStart();
}

function consumeCard(card) {
  GAME.cardsByPlayer[GAME.activePlayer][card] -= 1;
  GAME.cardUsedThisTurn = true;
  gameScreenEl.classList.remove("effect-strike", "effect-guard", "effect-reposition");
  gameScreenEl.classList.add(`effect-${card}`);
  window.setTimeout(() => {
    gameScreenEl.classList.remove("effect-strike", "effect-guard", "effect-reposition");
  }, 220);
}

function handleCardClick(cx, cy, unit) {
  if (!GAME.pendingCard) return false;
  const p = GAME.activePlayer;
  if (GAME.pendingCard === "strike") {
    GAME.strikeBuffByPlayer[p] = true;
    consumeCard("strike");
    addLog({ icon: LOG_ICON.card, text: `${playerLabel(p)} activated Strike: next attack +2 damage.` });
    GAME.pendingCard = null;
    return true;
  }
  if (GAME.pendingCard === "guard") {
    if (!unit || unit.player !== p) {
      addLog({ icon: LOG_ICON.info, text: "Guard card needs a friendly target." });
      return true;
    }
    GAME.guardByUnitId[unit.id] = 2;
    consumeCard("guard");
    GAME.pendingCard = null;
    addLog({ icon: LOG_ICON.card, text: `${playerLabel(p)} placed Guard on ${UNIT_DEFS[unit.type].name}.` });
    return true;
  }
  if (GAME.pendingCard === "reposition") {
    if (GAME.cardStep === "pick-unit") {
      if (!unit || unit.player !== p) {
        addLog({ icon: LOG_ICON.info, text: "Pick a friendly unit for Reposition." });
        return true;
      }
      GAME.selectedUnitId = unit.id;
      GAME.cardStep = "pick-cell";
      addLog({ icon: LOG_ICON.info, text: "Now pick an empty destination up to 2 tiles away." });
      return true;
    }
    if (GAME.cardStep === "pick-cell") {
      const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
      if (!selected) return true;
      if (
        !isEmpty(cx, cy) ||
        maxDiagDistance(selected.position.x, selected.position.y, cx, cy) > 2 ||
        !canOccupyTerrain(selected, cx, cy)
      ) {
        addLog({ icon: LOG_ICON.info, text: "Invalid Reposition destination (terrain or range)." });
        return true;
      }
      clearMomentum(selected.id);
      selected.position = { x: cx, y: cy };
      GAME.animations.movedUnitId = selected.id;
      consumeCard("reposition");
      GAME.pendingCard = null;
      GAME.cardStep = null;
      addLog({ icon: LOG_ICON.move, text: `${playerLabel(p)} repositioned ${UNIT_DEFS[selected.type].name}.` });
      window.setTimeout(() => {
        GAME.animations.movedUnitId = null;
        rerender();
      }, 260);
      return true;
    }
  }
  return false;
}

function applyAttack(attacker, target) {
  const usedHome = attacker.player === GAME.pandavPlayer && GAME.firstStrikeBonusPandav > 0;
  const damage = computeDamage(attacker, target);
  if (usedHome) GAME.firstStrikeBonusPandav = 0;
  GAME.animations.attackerId = attacker.id;
  GAME.animations.targetId = target.id;
  if (attacker.type === "A") {
    const dx = target.position.x - attacker.position.x;
    const dy = target.position.y - attacker.position.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    GAME.animations.archerImpact = { x: target.position.x, y: target.position.y, angle };
  } else {
    GAME.animations.archerImpact = null;
  }
  if (GAME.guardByUnitId[target.id]) {
    GAME.guardByUnitId[target.id] -= damage;
    if (GAME.guardByUnitId[target.id] <= 0) delete GAME.guardByUnitId[target.id];
    bumpMomentum(attacker, "attack");
    addLog({ icon: LOG_ICON.hit, text: `${playerLabel(attacker.player)} attack absorbed by Guard.` });
    GAME.damagePopup = { x: target.position.x, y: target.position.y, text: "BLOCK", absorbed: true };
  } else {
    target.hp -= damage;
    bumpMomentum(attacker, "attack");
    addLog({
      icon: LOG_ICON.attack,
      text: `${playerLabel(attacker.player)} ${UNIT_DEFS[attacker.type].name} hit ${UNIT_DEFS[target.type].name} for ${damage}.`,
    });
    if (target.hp > 0) bumpMomentum(target, "defend");
    if (target.hp <= 0 && attacker.player === GAME.pandavPlayer) {
      showToast("Clean strike — the line senses victory.", 2200);
      addLog({ icon: LOG_ICON.cheer, text: "The host roars approval at that blow." });
    }
    if (target.hp <= 0 && attacker.player === kauravPlayerNum() && GAME.mode === "ai") {
      addLog({ icon: LOG_ICON.info, text: "Regroup — losses happen; the war is not one swing." });
    }
    GAME.damagePopup = { x: target.position.x, y: target.position.y, text: String(damage), absorbed: false };
  }
  if (GAME.strikeBuffByPlayer[attacker.player]) GAME.strikeBuffByPlayer[attacker.player] = false;
  cellMap[target.position.y][target.position.x].classList.add("attack-hit");
  playFx(attacker.type === "A" ? "archer" : "hit");
  if (target.hp <= 0) GAME.units = GAME.units.filter((u) => u.id !== target.id);
  window.setTimeout(() => {
    GAME.animations.attackerId = null;
    GAME.animations.targetId = null;
    GAME.animations.archerImpact = null;
    GAME.damagePopup = null;
    rerender();
  }, 440);
}

function takeActionAt(x, y) {
  if (GAME.winner) return;
  const unit = getUnitAt(x, y);
  if (GAME.pendingCard) {
    handleCardClick(x, y, unit);
    rerender();
    return;
  }
  if (unit) {
    if (unit.player === GAME.activePlayer) {
      GAME.selectedUnitId = GAME.selectedUnitId === unit.id ? null : unit.id;
      playFx("select");
      addLog({
        icon: LOG_ICON.info,
        text: `${playerLabel(unit.player)} ${UNIT_DEFS[unit.type].name} ${GAME.selectedUnitId ? "selected" : "deselected"}.`,
      });
      rerender();
      return;
    }
    const attacker = GAME.units.find((u) => u.id === GAME.selectedUnitId);
    if (!attacker || attacker.player !== GAME.activePlayer || !canAttack(attacker, unit)) {
      addLog({ icon: LOG_ICON.info, text: "Select a valid attacker first." });
      rerender();
      return;
    }
    if (
      GAME.fogEnabled &&
      !isVisibleToPlayer(unit.position.x, unit.position.y, GAME.activePlayer)
    ) {
      addLog({ icon: LOG_ICON.info, text: "That foe is hidden in the fog — move scouts closer." });
      rerender();
      return;
    }
    applyAttack(attacker, unit);
    const winner = checkWin();
    if (winner) {
      GAME.winner = winner;
      showToast(`${factionName(winner)} host claims the field. Victory!`, 3600);
    } else switchTurn();
    rerender();
    if (!GAME.winner) queueAiIfNeeded();
    return;
  }
  const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
  if (!selected || selected.player !== GAME.activePlayer || !canMoveTo(selected, x, y)) {
    addLog({ icon: LOG_ICON.info, text: "Invalid move." });
    rerender();
    return;
  }
  const from = { ...selected.position };
  clearMomentum(selected.id);
  selected.position = { x, y };
  GAME.animations.movedUnitId = selected.id;
  playFx("move");
  addLog({
    icon: LOG_ICON.move,
    text: `${playerLabel(selected.player)} moved ${UNIT_DEFS[selected.type].name} from (${from.x},${from.y}) to (${x},${y}).`,
  });
  const winner = checkWin();
  if (winner) {
    GAME.winner = winner;
    showToast(`${factionName(winner)} host claims the field. Victory!`, 3600);
  } else switchTurn();
  rerender();
  window.setTimeout(() => {
    GAME.animations.movedUnitId = null;
    rerender();
  }, 260);
  if (!GAME.winner) queueAiIfNeeded();
}

function rerender() {
  renderBoardCells();
  highlightState();
  renderStatus();
}

function createBoard() {
  cellMap = [];
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${GAME.size}, var(--cell-size))`;
  boardEl.style.gridTemplateRows = `repeat(${GAME.size}, var(--cell-size))`;
  for (let y = 0; y < GAME.size; y++) {
    const row = [];
    for (let x = 0; x < GAME.size; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.addEventListener("click", () => takeActionAt(x, y));
      boardEl.appendChild(cell);
      row.push(cell);
    }
    cellMap.push(row);
  }
}

function initTerrain() {
  GAME.terrain = {};
  GAME.mudTiles = {};
  const mapByScenario = {
    opening: [
      [0, 5, "forest"],
      [1, 5, "forest"],
      [8, 4, "forest"],
      [9, 4, "forest"],
      [3, 3, "hill"],
      [6, 6, "hill"],
      // River flows diagonally through center
      [2, 5, "river"],
      [3, 5, "river"],
      [4, 5, "river"],
      [5, 4, "river"],
      [6, 4, "river"],
      [7, 4, "river"],
      [1, 6, "mud"],
      [8, 3, "mud"],
    ],
    frontline: [
      [0, 3, "forest"],
      [1, 3, "forest"],
      [8, 6, "forest"],
      [9, 6, "forest"],
      [2, 4, "hill"],
      [3, 4, "hill"],
      [7, 5, "hill"],
      // River across center row
      [1, 5, "river"],
      [2, 5, "river"],
      [3, 5, "river"],
      [4, 5, "river"],
      [5, 5, "river"],
      [6, 5, "river"],
      [1, 4, "mud"],
      [8, 5, "mud"],
    ],
    flanks: [
      [0, 4, "forest"],
      [0, 5, "forest"],
      [9, 4, "forest"],
      [9, 5, "forest"],
      [2, 3, "hill"],
      [7, 6, "hill"],
      // River flows from left-center to right-center
      [2, 5, "river"],
      [3, 5, "river"],
      [4, 5, "river"],
      [5, 4, "river"],
      [6, 4, "river"],
      [7, 4, "river"],
      [3, 6, "mud"],
      [6, 3, "mud"],
    ],
    "leader-hunt": [
      [0, 3, "forest"],
      [1, 3, "forest"],
      [8, 6, "forest"],
      [9, 6, "forest"],
      [3, 5, "hill"],
      [4, 4, "hill"],
      [6, 5, "hill"],
      // Narrow river through middle
      [3, 4, "river"],
      [4, 4, "river"],
      [5, 5, "river"],
      [6, 5, "river"],
      [7, 5, "river"],
      [2, 3, "mud"],
      [7, 6, "mud"],
    ],
    "forest-ambush": [
      [0, 3, "forest"],
      [1, 3, "forest"],
      [2, 3, "forest"],
      [7, 6, "forest"],
      [8, 6, "forest"],
      [9, 6, "forest"],
      [4, 4, "hill"],
      [5, 5, "hill"],
      // River cuts through the ambush zone
      [3, 5, "river"],
      [4, 5, "river"],
      [5, 5, "river"],
      [6, 4, "river"],
      [2, 5, "mud"],
      [7, 4, "mud"],
    ],
    "royal-siege": [
      [0, 2, "forest"],
      [1, 2, "forest"],
      [8, 7, "forest"],
      [9, 7, "forest"],
      [3, 3, "hill"],
      [4, 3, "hill"],
      [5, 3, "hill"],
      [2, 6, "hill"],
      // River encircles the central fortress
      [1, 5, "river"],
      [2, 5, "river"],
      [3, 5, "river"],
      [4, 5, "river"],
      [5, 4, "river"],
      [6, 4, "river"],
      [7, 4, "river"],
      [8, 4, "river"],
      [1, 4, "mud"],
      [8, 5, "mud"],
    ],
  };
  for (const [x, y, type] of mapByScenario[GAME.scenario]) {
    if (type === "mud") GAME.mudTiles[posKey(x, y)] = true;
    else GAME.terrain[posKey(x, y)] = type;
  }
}

function initUnits() {
  GAME.units = [];
  const base = [];
  if (GAME.scenario === "opening") {
    base.push(
      ["p1-L", "L", 1, 4, 0],
      ["p1-I1", "I", 1, 3, 2],
      ["p1-I2", "I", 1, 4, 2],
      ["p1-I3", "I", 1, 5, 2],
      ["p1-A1", "A", 1, 2, 1],
      ["p1-A2", "A", 1, 6, 1],
      ["p1-C", "C", 1, 0, 2],
      ["p1-E", "E", 1, 8, 1],
      ["p1-R", "R", 1, 9, 1],
      ["p2-L", "L", 2, 5, 9],
      ["p2-I1", "I", 2, 3, 7],
      ["p2-I2", "I", 2, 4, 7],
      ["p2-I3", "I", 2, 5, 7],
      ["p2-A1", "A", 2, 2, 8],
      ["p2-A2", "A", 2, 6, 8],
      ["p2-C", "C", 2, 9, 7],
      ["p2-E", "E", 2, 1, 8],
      ["p2-R", "R", 2, 0, 8]
    );
  } else if (GAME.scenario === "frontline") {
    base.push(
      ["p1-L", "L", 1, 3, 1],
      ["p1-I1", "I", 1, 2, 3],
      ["p1-I2", "I", 1, 3, 3],
      ["p1-I3", "I", 1, 4, 3],
      ["p1-A1", "A", 1, 1, 2],
      ["p1-C", "C", 1, 7, 2],
      ["p1-E", "E", 1, 5, 1],
      ["p1-R", "R", 1, 8, 2],
      ["p2-L", "L", 2, 4, 8],
      ["p2-I1", "I", 2, 2, 6],
      ["p2-I2", "I", 2, 3, 6],
      ["p2-I3", "I", 2, 4, 6],
      ["p2-A1", "A", 2, 6, 6],
      ["p2-C", "C", 2, 1, 6],
      ["p2-E", "E", 2, 2, 7],
      ["p2-R", "R", 2, 0, 6]
    );
  } else if (GAME.scenario === "flanks") {
    base.push(
      ["p1-L", "L", 1, 4, 0],
      ["p1-I1", "I", 1, 4, 2],
      ["p1-A1", "A", 1, 2, 1],
      ["p1-C1", "C", 1, 0, 3],
      ["p1-C2", "C", 1, 9, 2],
      ["p1-E", "E", 1, 6, 1],
      ["p1-R", "R", 1, 8, 0],
      ["p2-L", "L", 2, 5, 9],
      ["p2-I1", "I", 2, 4, 7],
      ["p2-A1", "A", 2, 5, 8],
      ["p2-C1", "C", 2, 0, 6],
      ["p2-C2", "C", 2, 9, 5],
      ["p2-E", "E", 2, 2, 7],
      ["p2-R", "R", 2, 1, 8]
    );
  } else if (GAME.scenario === "forest-ambush") {
    base.push(
      ["p1-L", "L", 1, 2, 0],
      ["p1-I1", "I", 1, 1, 2],
      ["p1-I2", "I", 1, 3, 2],
      ["p1-A1", "A", 1, 0, 1],
      ["p1-A2", "A", 1, 4, 1],
      ["p1-C1", "C", 1, 6, 2],
      ["p1-E", "E", 1, 5, 1],
      ["p1-R", "R", 1, 7, 1],
      ["p2-L", "L", 2, 5, 9],
      ["p2-I1", "I", 2, 4, 7],
      ["p2-I2", "I", 2, 6, 7],
      ["p2-A1", "A", 2, 7, 6],
      ["p2-A2", "A", 2, 3, 6],
      ["p2-C1", "C", 2, 1, 7],
      ["p2-E", "E", 2, 2, 6],
      ["p2-R", "R", 2, 0, 6]
    );
  } else if (GAME.scenario === "leader-hunt") {
    base.push(
      ["p1-L", "L", 1, 3, 1],
      ["p1-I1", "I", 1, 2, 2],
      ["p1-I2", "I", 1, 4, 2],
      ["p1-A1", "A", 1, 1, 1],
      ["p1-C1", "C", 1, 6, 2],
      ["p1-E", "E", 1, 5, 1],
      ["p1-R", "R", 1, 7, 1],
      ["p2-L", "L", 2, 4, 8],
      ["p2-I1", "I", 2, 3, 7],
      ["p2-I2", "I", 2, 5, 7],
      ["p2-A1", "A", 2, 6, 6],
      ["p2-C1", "C", 2, 1, 6],
      ["p2-E", "E", 2, 3, 6],
      ["p2-R", "R", 2, 0, 6]
    );
  } else {
    base.push(
      ["p1-L", "L", 1, 3, 0],
      ["p1-I1", "I", 1, 2, 2],
      ["p1-I2", "I", 1, 4, 2],
      ["p1-A1", "A", 1, 1, 1],
      ["p1-C1", "C", 1, 6, 2],
      ["p1-E", "E", 1, 4, 1],
      ["p1-R", "R", 1, 7, 1],
      ["p2-L", "L", 2, 4, 9],
      ["p2-I1", "I", 2, 3, 7],
      ["p2-I2", "I", 2, 5, 7],
      ["p2-A1", "A", 2, 6, 6],
      ["p2-C1", "C", 2, 1, 6],
      ["p2-E", "E", 2, 3, 6],
      ["p2-R", "R", 2, 0, 6]
    );
  }
  for (const [id, type, player, x, y] of base) {
    GAME.units.push({ id, type, player, hp: UNIT_DEFS[type].hp, position: { x, y } });
  }
}

function resetMatch() {
  if (aiTurnTimeoutId != null) {
    window.clearTimeout(aiTurnTimeoutId);
    aiTurnTimeoutId = null;
  }
  GAME.timerSecondsLeft = { 1: TIMER_BUDGET_SEC, 2: TIMER_BUDGET_SEC };
  GAME.activePlayer = 1;
  GAME.winner = null;
  GAME.selectedUnitId = null;
  GAME.pendingCard = null;
  GAME.cardStep = null;
  GAME.cardUsedThisTurn = false;
  GAME.strikeBuffByPlayer = { 1: false, 2: false };
  GAME.guardByUnitId = {};
  GAME.cardsByPlayer = {
    1: { strike: 2, guard: 2, reposition: 2 },
    2: { strike: 2, guard: 2, reposition: 2 },
  };
  GAME.lastAction = "-";
  GAME.actionLog = [];
  GAME.momentumByUnitId = {};
  GAME.animations = { attackerId: null, targetId: null, archerImpact: null, movedUnitId: null };
  GAME.damagePopup = null;
  if (GAME.mode === "local") {
    GAME.pandavPlayer = Math.random() < 0.5 ? 1 : 2;
  } else {
    const side = sideSelectEl && sideSelectEl.value ? sideSelectEl.value : "pandav";
    GAME.pandavPlayer = side === "pandav" ? 1 : 2;
  }
  GAME.firstStrikeBonusPandav = consumeHomeBonus() ? 1 : 0;
  initTerrain();
  initUnits();
  addLog({
    icon: LOG_ICON.terrain,
    text: `Scenario "${GAME.scenario}" started. ${playerLabel(GAME.activePlayer)} to act.`,
  });
  if (GAME.firstStrikeBonusPandav) {
    addLog({
      icon: LOG_ICON.morale,
      text: "Camp blessing: your first Pandav strike this battle deals +1 damage.",
    });
  }
  onTurnStart();
  rerender();
  queueAiIfNeeded();
  stopChessTimer();
  startChessTimer();
}

function getNearestEnemy(unit) {
  let best = null;
  let bestD = Infinity;
  for (const other of GAME.units) {
    if (other.player === unit.player) continue;
    const d = maxDiagDistance(unit.position.x, unit.position.y, other.position.x, other.position.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function aiTurn() {
  if (GAME.winner || GAME.mode !== "ai" || GAME.activePlayer !== 2) return;
  const aiUnits = GAME.units.filter((u) => u.player === 2);
  for (const u of aiUnits) {
    const targets = attackTargets(u);
    if (targets.length) {
      GAME.selectedUnitId = u.id;
      applyAttack(u, targets[0]);
      const winner = checkWin();
      if (winner) {
        GAME.winner = winner;
        showToast(`${factionName(winner)} host claims the field. Victory!`, 3600);
      } else switchTurn();
      rerender();
      return;
    }
  }
  for (const u of aiUnits) {
    const nearEnemy = getNearestEnemy(u);
    if (!nearEnemy) continue;
    const moves = movementTargets(u);
    if (!moves.length) continue;
    moves.sort(
      (a, b) =>
        maxDiagDistance(a.x, a.y, nearEnemy.position.x, nearEnemy.position.y) -
        maxDiagDistance(b.x, b.y, nearEnemy.position.x, nearEnemy.position.y)
    );
    clearMomentum(u.id);
    u.position = { x: moves[0].x, y: moves[0].y };
    GAME.animations.movedUnitId = u.id;
    addLog({ icon: LOG_ICON.move, text: `AI moved ${UNIT_DEFS[u.type].name}.` });
    const winner = checkWin();
    if (winner) {
      GAME.winner = winner;
      showToast(`${factionName(winner)} host claims the field. Victory!`, 3600);
    } else switchTurn();
    rerender();
    window.setTimeout(() => {
      GAME.animations.movedUnitId = null;
      rerender();
    }, 260);
    return;
  }
  addLog({ icon: LOG_ICON.info, text: "AI skipped turn." });
  switchTurn();
  rerender();
}

function queueAiIfNeeded() {
  if (aiTurnTimeoutId != null) {
    window.clearTimeout(aiTurnTimeoutId);
    aiTurnTimeoutId = null;
  }
  if (GAME.mode === "ai" && GAME.activePlayer === 2 && !GAME.winner) {
    aiTurnTimeoutId = window.setTimeout(() => {
      aiTurnTimeoutId = null;
      aiTurn();
    }, 500);
  }
}

function attachRulesDialog() {
  rulesBtn.addEventListener("click", () => rulesDialogEl.showModal());
  closeRulesBtn.addEventListener("click", () => rulesDialogEl.close());
}

function updateScenarioPreview(scenario) {
  if (!battleMapPreviewEl || !battlePreviewTitleEl || !battlePreviewDescEl) return;
  const previewClassList = [
    "preview-opening",
    "preview-frontline",
    "preview-flanks",
    "preview-leader-hunt",
    "preview-forest-ambush",
    "preview-royal-siege",
  ];
  battleMapPreviewEl.classList.remove(...previewClassList);
  battleMapPreviewEl.classList.add(`preview-${scenario}`);
  const meta = SCENARIO_PREVIEW_META[scenario] || SCENARIO_PREVIEW_META.opening;
  battlePreviewTitleEl.textContent = meta.title;
  battlePreviewDescEl.textContent = meta.desc;
}

function setupHomeInteractives() {
  const preview = document.getElementById("battleMapPreview");
  if (!preview) return;
  preview.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-home-bonus]");
    if (!btn) return;
    sessionStorage.setItem("ranbhoomiHomeBonus", JSON.stringify({ strike: true }));
    showToast("The field remembers your attention — first Pandav strike next battle +1 damage.");
    playFx("select");
  });
}

function setupScenarioCards() {
  const cards = scenarioCardsEl.querySelectorAll(".scenario-card");
  for (const card of cards) {
    card.addEventListener("click", () => {
      for (const c of cards) c.classList.remove("selected");
      card.classList.add("selected");
      GAME.scenario = card.dataset.scenario;
      GAME.selectedScenarioLabel = card.querySelector(".scenario-name").textContent.trim();
      updateScenarioPreview(GAME.scenario);
      playFx("select");
    });
  }
}

function enterGameplay() {
  homeScreenEl.classList.add("hidden");
  gameScreenEl.classList.remove("hidden");
  resetMatch();
}

function backToHome() {
  stopChessTimer();
  gameScreenEl.classList.add("hidden");
  homeScreenEl.classList.remove("hidden");
}

function initUI() {
  boardEl = document.getElementById("board");
  currentPlayerLabel = document.getElementById("currentPlayerLabel");
  turnBannerEl = document.getElementById("turnBanner");
  winnerLabel = document.getElementById("winnerLabel");
  lastActionEl = document.getElementById("lastAction");
  actionLogEl = document.getElementById("actionLog");
  rulesBtn = document.getElementById("rulesBtn");
  resetBtn = document.getElementById("resetBtn");
  rulesDialogEl = document.getElementById("rulesDialog");
  closeRulesBtn = document.getElementById("closeRulesBtn");
  modeSelectEl = document.getElementById("modeSelect");
  fogToggleEl = document.getElementById("fogToggle");
  phaseStateEl = document.getElementById("phaseState");
  bonusStateEl = document.getElementById("bonusState");
  cardsStateEl = document.getElementById("cardsState");
  homeScreenEl = document.getElementById("homeScreen");
  gameScreenEl = document.getElementById("gameScreen");
  goToBattleBtn = document.getElementById("goToBattleBtn");
  backHomeBtn = document.getElementById("backHomeBtn");
  scenarioCardsEl = document.getElementById("scenarioCards");
  themeSelectEl = document.getElementById("themeSelect");
  battleMapPreviewEl = document.getElementById("battleMapPreview");
  battlePreviewTitleEl = document.getElementById("battlePreviewTitle");
  battlePreviewDescEl = document.getElementById("battlePreviewDesc");
  momentumStateEl = document.getElementById("momentumState");
  eventBannerEl = document.getElementById("eventBanner");
  toastEl = document.getElementById("appToast");
  sideSelectEl = document.getElementById("sideSelect");
  aiSideWrapEl = document.getElementById("aiSideWrap");
  clockP1El = document.getElementById("clockP1");
  clockP2El = document.getElementById("clockP2");
  clockP1Wrap = document.getElementById("clockP1Wrap");
  clockP2Wrap = document.getElementById("clockP2Wrap");
  timerToggleBtn = document.getElementById("timerToggleBtn");
  playLocalBtnEl = document.getElementById("playLocalBtn");
  playAiBtnEl = document.getElementById("playAiBtn");
  homeSettingsBtnEl = document.getElementById("homeSettingsBtn");
  settingsDialogEl = document.getElementById("settingsDialog");
  closeSettingsBtnEl = document.getElementById("closeSettingsBtn");
  settingsApplyBtnEl = document.getElementById("settingsApplyBtn");
  settingsThemeEl = document.getElementById("settingsTheme");
  settingsModeEl = document.getElementById("settingsMode");
  settingsTimerEl = document.getElementById("settingsTimer");
  settingsFogEl = document.getElementById("settingsFog");

  function syncTimerButton() {
    if (!timerToggleBtn) return;
    const on = GAME.timerEnabled;
    timerToggleBtn.setAttribute("aria-pressed", on ? "true" : "false");
    timerToggleBtn.textContent = on ? "⏱ Clock: On" : "⏱ Clock: Off";
  }

  function syncAiSideVisibility() {
    if (aiSideWrapEl) aiSideWrapEl.classList.toggle("hidden", modeSelectEl.value !== "ai");
  }

  function applySettingsFromDialog() {
    const theme = settingsThemeEl ? settingsThemeEl.value : "kurukshetra";
    const mode  = settingsModeEl  ? settingsModeEl.value  : "local";
    const timer = settingsTimerEl ? settingsTimerEl.checked : true;
    const fog   = settingsFogEl   ? settingsFogEl.checked  : false;
    applyTheme(theme);
    if (themeSelectEl) themeSelectEl.value = theme;
    GAME.mode = mode;
    if (modeSelectEl) modeSelectEl.value = mode;
    GAME.timerEnabled = timer;
    GAME.fogEnabled = fog;
    if (fogToggleEl) fogToggleEl.checked = fog;
    syncAiSideVisibility();
    syncTimerButton();
  }

  // Home screen: Play Local button
  if (playLocalBtnEl) {
    playLocalBtnEl.addEventListener("click", () => {
      GAME.mode = "local";
      if (modeSelectEl) modeSelectEl.value = "local";
      syncAiSideVisibility();
      enterGameplay();
    });
  }

  // Home screen: Play vs AI button
  if (playAiBtnEl) {
    playAiBtnEl.addEventListener("click", () => {
      GAME.mode = "ai";
      if (modeSelectEl) modeSelectEl.value = "ai";
      syncAiSideVisibility();
      enterGameplay();
    });
  }

  // Home screen: Settings button
  if (homeSettingsBtnEl && settingsDialogEl) {
    homeSettingsBtnEl.addEventListener("click", () => {
      // Sync dialog controls to current state
      if (settingsThemeEl && themeSelectEl) settingsThemeEl.value = themeSelectEl.value;
      if (settingsModeEl && modeSelectEl) settingsModeEl.value = modeSelectEl.value;
      if (settingsTimerEl) settingsTimerEl.checked = GAME.timerEnabled;
      if (settingsFogEl) settingsFogEl.checked = GAME.fogEnabled;
      settingsDialogEl.showModal();
    });
  }

  if (closeSettingsBtnEl && settingsDialogEl) {
    closeSettingsBtnEl.addEventListener("click", () => settingsDialogEl.close());
  }

  if (settingsApplyBtnEl && settingsDialogEl) {
    settingsApplyBtnEl.addEventListener("click", () => {
      applySettingsFromDialog();
      settingsDialogEl.close();
      // Enter gameplay after applying
      GAME.mode = settingsModeEl ? settingsModeEl.value : "local";
      syncAiSideVisibility();
      enterGameplay();
    });
  }

  // Settings dialog: live theme preview
  if (settingsThemeEl) {
    settingsThemeEl.addEventListener("change", () => {
      applyTheme(settingsThemeEl.value);
      if (themeSelectEl) themeSelectEl.value = settingsThemeEl.value;
    });
  }

  setupHomeInteractives();
  resetBtn.addEventListener("click", resetMatch);
  modeSelectEl.addEventListener("change", () => {
    GAME.mode = modeSelectEl.value;
    syncAiSideVisibility();
    resetMatch();
  });
  if (sideSelectEl) {
    sideSelectEl.addEventListener("change", () => {
      if (GAME.mode === "ai") resetMatch();
    });
  }
  fogToggleEl.addEventListener("change", () => {
    GAME.fogEnabled = fogToggleEl.checked;
    rerender();
  });
  // goToBattleBtn may not exist now (removed from HTML), but keep for safety
  if (goToBattleBtn) goToBattleBtn.addEventListener("click", enterGameplay);
  backHomeBtn.addEventListener("click", backToHome);
  themeSelectEl.addEventListener("change", () => {
    applyTheme(themeSelectEl.value);
  });
  setupScenarioCards();
  updateScenarioPreview(GAME.scenario);
  syncAiSideVisibility();
  syncTimerButton();

  if (timerToggleBtn) {
    timerToggleBtn.addEventListener("click", () => {
      GAME.timerEnabled = !GAME.timerEnabled;
      syncTimerButton();
      if (GAME.timerEnabled) {
        GAME.timerSecondsLeft = { 1: TIMER_BUDGET_SEC, 2: TIMER_BUDGET_SEC };
        startChessTimer();
      } else {
        stopChessTimer();
      }
      updateTimerDisplay();
    });
  }

  cardsStateEl.addEventListener("click", (e) => {
    const b = e.target.closest(".card-btn");
    if (!b || b.disabled) return;
    const card = b.dataset.card;
    if (!card || GAME.cardUsedThisTurn) return;
    const left = GAME.cardsByPlayer[GAME.activePlayer][card];
    if (left <= 0) return;
    GAME.pendingCard = card;
    GAME.cardStep = card === "reposition" ? "pick-unit" : "pick-target";
    addLog({ icon: LOG_ICON.card, text: `${playerLabel(GAME.activePlayer)} preparing ${card} card.` });
    rerender();
  });

  updateTimerDisplay();
}

function main() {
  initUI();
  createBoard();
  attachRulesDialog();
  applyTheme("kurukshetra");
}

document.addEventListener("DOMContentLoaded", main);

