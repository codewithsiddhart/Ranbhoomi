const GAME = {
  size: 8,
  activePlayer: 1,
  winner: null,
  mode: "local",
  scenario: "opening",
  fogEnabled: false,
  selectedUnitId: null,
  units: [],
  terrain: {},
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
};

const UNIT_DEFS = {
  L: { name: "Leader", move: 1, hp: 10, damage: 3, melee: true, archerRange: null },
  I: { name: "Infantry", move: 1, hp: 6, damage: 2, melee: true, archerRange: null },
  A: { name: "Archer", move: 1, hp: 4, damage: 2, melee: false, archerRange: [2, 3] },
  C: { name: "Cavalry", move: 2, hp: 6, damage: 3, melee: true, archerRange: null },
  E: { name: "Elephant", move: 1, hp: 9, damage: 4, melee: true, archerRange: null },
  R: { name: "Chariot", move: 2, hp: 7, damage: 3, melee: true, archerRange: null },
};

const UNIT_LETTER_BY_TYPE = { L: "L", I: "I", A: "A", C: "C", E: "E", R: "R" };

let cellMap = [];
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
let scenarioSelectEl;
let fogToggleEl;
let phaseStateEl;
let bonusStateEl;
let cardsStateEl;

function posKey(x, y) {
  return `${x}-${y}`;
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
  return player === 1 ? "P1" : "P2";
}

function addLog(line) {
  GAME.lastAction = line;
  GAME.actionLog.unshift(line);
  GAME.actionLog = GAME.actionLog.slice(0, 14);
  lastActionEl.textContent = GAME.lastAction;
  actionLogEl.innerHTML = "";
  for (const item of GAME.actionLog) {
    const li = document.createElement("li");
    li.textContent = item;
    actionLogEl.appendChild(li);
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
  const moveDist = UNIT_DEFS[unit.type].move;
  const out = [];
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      if (!isEmpty(x, y)) continue;
      if (maxDiagDistance(unit.position.x, unit.position.y, x, y) === moveDist) out.push({ x, y });
    }
  }
  return out;
}

function canMoveTo(unit, x, y) {
  if (!withinGrid(x, y) || !isEmpty(x, y)) return false;
  return maxDiagDistance(unit.position.x, unit.position.y, x, y) === UNIT_DEFS[unit.type].move;
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
  return GAME.units.filter((other) => canAttack(unit, other));
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
  return Math.max(1, base + lineBonus + surroundBonus + strikeBonus + hillBonus - forestShield);
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
      cellMap[y][x].classList.remove("selected", "move-target", "attack-target", "attack-hit", "fog-hidden");
    }
  }
}

function highlightState() {
  clearHighlights();
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

function renderBoardCells() {
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      const cell = cellMap[y][x];
      cell.innerHTML = "";
      cell.classList.remove("terrain-forest", "terrain-hill");
      const terrain = getTerrainAt(x, y);
      if (terrain === "forest") cell.classList.add("terrain-forest");
      if (terrain === "hill") cell.classList.add("terrain-hill");
    }
  }
  for (const u of GAME.units) {
    const hidden = GAME.fogEnabled && u.player !== GAME.activePlayer && !isVisibleToPlayer(u.position.x, u.position.y, GAME.activePlayer);
    if (hidden) continue;
    const cell = cellMap[u.position.y][u.position.x];
    const unitEl = document.createElement("div");
    unitEl.className = `unit ${u.player === 1 ? "p1" : "p2"}`;
    const letter = document.createElement("div");
    letter.className = "letter";
    if (u.type === "L" && u.hp <= Math.ceil(UNIT_DEFS.L.hp / 2)) letter.classList.add("ability-ready");
    letter.textContent = UNIT_LETTER_BY_TYPE[u.type];
    const hp = document.createElement("div");
    hp.className = "hp";
    hp.textContent = `HP ${u.hp}${GAME.guardByUnitId[u.id] ? " +Guard" : ""}`;
    unitEl.appendChild(letter);
    unitEl.appendChild(hp);
    cell.appendChild(unitEl);
  }
}

function renderStatus() {
  currentPlayerLabel.textContent = playerLabel(GAME.activePlayer);
  turnBannerEl.classList.remove("p1", "p2");
  turnBannerEl.classList.add(GAME.activePlayer === 1 ? "p1" : "p2");
  if (GAME.winner) {
    turnBannerEl.classList.add("hidden");
    winnerLabel.classList.remove("hidden");
    winnerLabel.textContent = `${playerLabel(GAME.winner)} wins the war.`;
  } else {
    turnBannerEl.classList.remove("hidden");
    winnerLabel.classList.add("hidden");
  }
  phaseStateEl.textContent = `Mode: ${GAME.mode === "ai" ? "P1 vs AI" : "Local P1 vs P2"} | Terrain + Fog + Abilities active`;
  const p1Line = getFormationBonusForPlayer(1).line ? "ON" : "OFF";
  const p2Line = getFormationBonusForPlayer(2).line ? "ON" : "OFF";
  bonusStateEl.textContent = `Formation Line bonus -> P1: ${p1Line}, P2: ${p2Line}`;
  cardsStateEl.innerHTML = renderCardsUI();
  attachCardButtons();
}

function renderCardsUI() {
  const p = GAME.activePlayer;
  const c = GAME.cardsByPlayer[p];
  return `
    <div style="margin-bottom:6px;">${playerLabel(p)} cards (use one per turn):</div>
    <div class="top-controls">
      <button class="btn card-btn" data-card="strike" ${c.strike < 1 || GAME.cardUsedThisTurn ? "disabled" : ""}>Strike (${c.strike})</button>
      <button class="btn card-btn" data-card="guard" ${c.guard < 1 || GAME.cardUsedThisTurn ? "disabled" : ""}>Guard (${c.guard})</button>
      <button class="btn card-btn" data-card="reposition" ${c.reposition < 1 || GAME.cardUsedThisTurn ? "disabled" : ""}>Reposition (${c.reposition})</button>
    </div>
    <div class="hint">${GAME.pendingCard ? `Pending card: ${GAME.pendingCard}` : "No pending card."}</div>
  `;
}

function attachCardButtons() {
  const btns = cardsStateEl.querySelectorAll(".card-btn");
  for (const b of btns) {
    b.addEventListener("click", () => {
      const card = b.dataset.card;
      if (GAME.cardUsedThisTurn) return;
      const left = GAME.cardsByPlayer[GAME.activePlayer][card];
      if (left <= 0) return;
      GAME.pendingCard = card;
      GAME.cardStep = card === "reposition" ? "pick-unit" : "pick-target";
      addLog(`${playerLabel(GAME.activePlayer)} preparing ${card} card.`);
      rerender();
    });
  }
}

function switchTurn() {
  GAME.activePlayer = GAME.activePlayer === 1 ? 2 : 1;
  GAME.selectedUnitId = null;
  GAME.pendingCard = null;
  GAME.cardStep = null;
  GAME.cardUsedThisTurn = false;
}

function consumeCard(card) {
  GAME.cardsByPlayer[GAME.activePlayer][card] -= 1;
  GAME.cardUsedThisTurn = true;
}

function handleCardClick(cx, cy, unit) {
  if (!GAME.pendingCard) return false;
  const p = GAME.activePlayer;
  if (GAME.pendingCard === "strike") {
    GAME.strikeBuffByPlayer[p] = true;
    consumeCard("strike");
    addLog(`${playerLabel(p)} activated Strike: next attack +2 damage.`);
    GAME.pendingCard = null;
    return true;
  }
  if (GAME.pendingCard === "guard") {
    if (!unit || unit.player !== p) {
      addLog("Guard card needs a friendly target.");
      return true;
    }
    GAME.guardByUnitId[unit.id] = 2;
    consumeCard("guard");
    GAME.pendingCard = null;
    addLog(`${playerLabel(p)} placed Guard on ${UNIT_DEFS[unit.type].name}.`);
    return true;
  }
  if (GAME.pendingCard === "reposition") {
    if (GAME.cardStep === "pick-unit") {
      if (!unit || unit.player !== p) {
        addLog("Pick a friendly unit for Reposition.");
        return true;
      }
      GAME.selectedUnitId = unit.id;
      GAME.cardStep = "pick-cell";
      addLog("Now pick an empty destination up to 2 tiles away.");
      return true;
    }
    if (GAME.cardStep === "pick-cell") {
      const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
      if (!selected) return true;
      if (!isEmpty(cx, cy) || maxDiagDistance(selected.position.x, selected.position.y, cx, cy) > 2) {
        addLog("Invalid Reposition destination.");
        return true;
      }
      selected.position = { x: cx, y: cy };
      consumeCard("reposition");
      GAME.pendingCard = null;
      GAME.cardStep = null;
      addLog(`${playerLabel(p)} repositioned ${UNIT_DEFS[selected.type].name}.`);
      return true;
    }
  }
  return false;
}

function applyAttack(attacker, target) {
  const damage = computeDamage(attacker, target);
  if (GAME.guardByUnitId[target.id]) {
    GAME.guardByUnitId[target.id] -= damage;
    if (GAME.guardByUnitId[target.id] <= 0) delete GAME.guardByUnitId[target.id];
    addLog(`${playerLabel(attacker.player)} attack absorbed by Guard.`);
  } else {
    target.hp -= damage;
    addLog(`${playerLabel(attacker.player)} ${UNIT_DEFS[attacker.type].name} hit ${UNIT_DEFS[target.type].name} for ${damage}.`);
  }
  if (GAME.strikeBuffByPlayer[attacker.player]) GAME.strikeBuffByPlayer[attacker.player] = false;
  cellMap[target.position.y][target.position.x].classList.add("attack-hit");
  if (target.hp <= 0) GAME.units = GAME.units.filter((u) => u.id !== target.id);
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
      addLog(`${playerLabel(unit.player)} ${UNIT_DEFS[unit.type].name} ${GAME.selectedUnitId ? "selected" : "deselected"}.`);
      rerender();
      return;
    }
    const attacker = GAME.units.find((u) => u.id === GAME.selectedUnitId);
    if (!attacker || attacker.player !== GAME.activePlayer || !canAttack(attacker, unit)) {
      addLog("Select a valid attacker first.");
      rerender();
      return;
    }
    applyAttack(attacker, unit);
    const winner = checkWin();
    if (winner) GAME.winner = winner;
    else switchTurn();
    rerender();
    if (!GAME.winner) queueAiIfNeeded();
    return;
  }
  const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
  if (!selected || selected.player !== GAME.activePlayer || !canMoveTo(selected, x, y)) {
    addLog("Invalid move.");
    rerender();
    return;
  }
  const from = { ...selected.position };
  selected.position = { x, y };
  addLog(`${playerLabel(selected.player)} moved ${UNIT_DEFS[selected.type].name} from (${from.x},${from.y}) to (${x},${y}).`);
  const winner = checkWin();
  if (winner) GAME.winner = winner;
  else switchTurn();
  rerender();
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
  const mapByScenario = {
    opening: [
      [2, 3, "forest"],
      [5, 4, "forest"],
      [3, 3, "hill"],
      [4, 4, "hill"],
    ],
    frontline: [
      [2, 3, "hill"],
      [3, 3, "hill"],
      [4, 4, "forest"],
      [5, 4, "forest"],
    ],
    flanks: [
      [0, 3, "forest"],
      [7, 4, "forest"],
      [1, 2, "hill"],
      [6, 5, "hill"],
    ],
    "leader-hunt": [
      [3, 2, "forest"],
      [4, 5, "forest"],
      [3, 4, "hill"],
      [4, 3, "hill"],
    ],
  };
  for (const [x, y, type] of mapByScenario[GAME.scenario]) {
    GAME.terrain[posKey(x, y)] = type;
  }
}

function initUnits() {
  GAME.units = [];
  const base = [];
  if (GAME.scenario === "opening") {
    base.push(
      ["p1-L", "L", 1, 3, 0], ["p1-I1", "I", 1, 2, 2], ["p1-I2", "I", 1, 3, 2], ["p1-I3", "I", 1, 4, 2],
      ["p1-A1", "A", 1, 2, 1], ["p1-A2", "A", 1, 4, 1], ["p1-C", "C", 1, 0, 2], ["p1-E", "E", 1, 6, 1], ["p1-R", "R", 1, 7, 1],
      ["p2-L", "L", 2, 4, 7], ["p2-I1", "I", 2, 2, 5], ["p2-I2", "I", 2, 3, 5], ["p2-I3", "I", 2, 4, 5],
      ["p2-A1", "A", 2, 2, 6], ["p2-A2", "A", 2, 4, 6], ["p2-C", "C", 2, 7, 5], ["p2-E", "E", 2, 1, 6], ["p2-R", "R", 2, 0, 6]
    );
  } else if (GAME.scenario === "frontline") {
    base.push(
      ["p1-L", "L", 1, 3, 1], ["p1-I1", "I", 1, 2, 3], ["p1-I2", "I", 1, 3, 3], ["p1-I3", "I", 1, 4, 3], ["p1-A1", "A", 1, 1, 2], ["p1-C", "C", 1, 6, 2], ["p1-E", "E", 1, 5, 1], ["p1-R", "R", 1, 7, 2],
      ["p2-L", "L", 2, 4, 6], ["p2-I1", "I", 2, 2, 4], ["p2-I2", "I", 2, 3, 4], ["p2-I3", "I", 2, 4, 4], ["p2-A1", "A", 2, 6, 5], ["p2-C", "C", 2, 1, 5], ["p2-E", "E", 2, 2, 6], ["p2-R", "R", 2, 0, 5]
    );
  } else if (GAME.scenario === "flanks") {
    base.push(
      ["p1-L", "L", 1, 3, 0], ["p1-I1", "I", 1, 3, 2], ["p1-A1", "A", 1, 2, 1], ["p1-C1", "C", 1, 0, 3], ["p1-C2", "C", 1, 7, 2], ["p1-E", "E", 1, 5, 1], ["p1-R", "R", 1, 6, 0],
      ["p2-L", "L", 2, 4, 7], ["p2-I1", "I", 2, 4, 5], ["p2-A1", "A", 2, 5, 6], ["p2-C1", "C", 2, 0, 5], ["p2-C2", "C", 2, 7, 4], ["p2-E", "E", 2, 2, 6], ["p2-R", "R", 2, 1, 7]
    );
  } else {
    base.push(
      ["p1-L", "L", 1, 3, 1], ["p1-I1", "I", 1, 2, 2], ["p1-A1", "A", 1, 1, 1], ["p1-C1", "C", 1, 6, 2], ["p1-E", "E", 1, 4, 1], ["p1-R", "R", 1, 7, 1],
      ["p2-L", "L", 2, 4, 6], ["p2-I1", "I", 2, 4, 5], ["p2-A1", "A", 2, 6, 6], ["p2-C1", "C", 2, 1, 5], ["p2-E", "E", 2, 3, 6], ["p2-R", "R", 2, 0, 6]
    );
  }
  for (const [id, type, player, x, y] of base) {
    GAME.units.push({ id, type, player, hp: UNIT_DEFS[type].hp, position: { x, y } });
  }
}

function resetMatch() {
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
  initTerrain();
  initUnits();
  addLog(`Scenario "${GAME.scenario}" started. ${playerLabel(GAME.activePlayer)} to act.`);
  rerender();
  queueAiIfNeeded();
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
      if (winner) GAME.winner = winner;
      else switchTurn();
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
    u.position = { x: moves[0].x, y: moves[0].y };
    addLog(`AI moved ${UNIT_DEFS[u.type].name}.`);
    const winner = checkWin();
    if (winner) GAME.winner = winner;
    else switchTurn();
    rerender();
    return;
  }
  addLog("AI skipped turn.");
  switchTurn();
  rerender();
}

function queueAiIfNeeded() {
  if (GAME.mode === "ai" && GAME.activePlayer === 2 && !GAME.winner) {
    window.setTimeout(aiTurn, 500);
  }
}

function attachRulesDialog() {
  rulesBtn.addEventListener("click", () => rulesDialogEl.showModal());
  closeRulesBtn.addEventListener("click", () => rulesDialogEl.close());
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
  scenarioSelectEl = document.getElementById("scenarioSelect");
  fogToggleEl = document.getElementById("fogToggle");
  phaseStateEl = document.getElementById("phaseState");
  bonusStateEl = document.getElementById("bonusState");
  cardsStateEl = document.getElementById("cardsState");

  resetBtn.addEventListener("click", resetMatch);
  modeSelectEl.addEventListener("change", () => {
    GAME.mode = modeSelectEl.value;
    resetMatch();
  });
  scenarioSelectEl.addEventListener("change", () => {
    GAME.scenario = scenarioSelectEl.value;
    resetMatch();
  });
  fogToggleEl.addEventListener("change", () => {
    GAME.fogEnabled = fogToggleEl.checked;
    rerender();
  });
}

function main() {
  initUI();
  createBoard();
  attachRulesDialog();
  resetMatch();
}

document.addEventListener("DOMContentLoaded", main);

