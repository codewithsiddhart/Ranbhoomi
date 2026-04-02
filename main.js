const GAME = {
  size: 8,
  players: [1, 2],
  activePlayer: 1,
  winner: null,
  selectedUnitId: null,
  units: [],
  lastAction: "-",
  actionLog: [],
};

const UNIT_DEFS = {
  L: { name: "Leader", move: 1, melee: true, archer: false, archerRange: null, damage: 3, hp: 10 },
  I: { name: "Infantry", move: 1, melee: true, archer: false, archerRange: null, damage: 3, hp: 5 },
  A: { name: "Archer", move: 1, melee: false, archer: true, archerRange: [2, 3], damage: 3, hp: 4 },
  C: { name: "Cavalry", move: 2, melee: true, archer: false, archerRange: null, damage: 3, hp: 6 },
};

const UNIT_LETTER_BY_TYPE = {
  L: "L",
  I: "I",
  A: "A",
  C: "C",
};

let cellMap = [];
let boardEl;
let currentPlayerLabel;
let winnerLabel;
let lastActionEl;
let actionLogEl;

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

function ChebyshevRange(x1, y1, x2, y2, minInclusive, maxInclusive) {
  const d = maxDiagDistance(x1, y1, x2, y2);
  return d >= minInclusive && d <= maxInclusive;
}

function getMovementTargets(unit) {
  const def = UNIT_DEFS[unit.type];
  const moveDist = def.move;
  const targets = [];

  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      if (!withinGrid(x, y)) continue;
      if (!isEmpty(x, y)) continue;
      const d = maxDiagDistance(unit.position.x, unit.position.y, x, y);
      if (d === moveDist) targets.push({ x, y });
    }
  }

  return targets;
}

function getAttackTargets(unit) {
  const def = UNIT_DEFS[unit.type];
  const targets = [];

  for (const other of GAME.units) {
    if (other.player === unit.player) continue;
    if (UNIT_DEFS[unit.type].melee) {
      if (maxDiagDistance(unit.position.x, unit.position.y, other.position.x, other.position.y) === 1) targets.push(other);
    } else if (def.archer) {
      if (ChebyshevRange(unit.position.x, unit.position.y, other.position.x, other.position.y, def.archerRange[0], def.archerRange[1])) {
        targets.push(other);
      }
    }
  }

  return targets;
}

function unitToPlayerName(player) {
  return player === 1 ? "P1" : "P2";
}

function addLog(line) {
  GAME.lastAction = line;
  GAME.actionLog.unshift(line);
  GAME.actionLog = GAME.actionLog.slice(0, 30);
  lastActionEl.textContent = GAME.lastAction;

  // Keep the log simple: re-render items.
  actionLogEl.innerHTML = "";
  for (const item of GAME.actionLog) {
    const li = document.createElement("li");
    li.textContent = item;
    actionLogEl.appendChild(li);
  }
}

function clearHighlights() {
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      cellMap[y][x].classList.remove("selected", "move-target", "attack-target");
    }
  }
}

function highlightSelectedAndTargets() {
  clearHighlights();
  if (GAME.winner) return;
  if (!GAME.selectedUnitId) return;

  const selected = GAME.units.find((u) => u.id === GAME.selectedUnitId);
  if (!selected) return;

  cellMap[selected.position.y][selected.position.x].classList.add("selected");

  const movementTargets = getMovementTargets(selected);
  for (const t of movementTargets) {
    cellMap[t.y][t.x].classList.add("move-target");
  }

  const attackTargets = getAttackTargets(selected);
  for (const t of attackTargets) {
    cellMap[t.position.y][t.position.x].classList.add("attack-target");
  }
}

function renderUnits() {
  for (let y = 0; y < GAME.size; y++) {
    for (let x = 0; x < GAME.size; x++) {
      cellMap[y][x].innerHTML = "";
    }
  }

  // Units
  for (const u of GAME.units) {
    const cell = cellMap[u.position.y][u.position.x];
    const letter = UNIT_LETTER_BY_TYPE[u.type] || "?";

    const unitEl = document.createElement("div");
    unitEl.className = `unit ${u.player === 1 ? "p1" : "p2"}`;

    const letterEl = document.createElement("div");
    letterEl.className = "letter";
    letterEl.textContent = letter;

    const hpEl = document.createElement("div");
    hpEl.className = "hp";
    hpEl.textContent = `HP ${u.hp}`;

    unitEl.appendChild(letterEl);
    unitEl.appendChild(hpEl);
    cell.appendChild(unitEl);
  }
}

function renderBoardCoordinatesInConsole() {
  // Coordinates are already logged on click; this function is a placeholder for future debug additions.
}

function renderStatus() {
  currentPlayerLabel.textContent = unitToPlayerName(GAME.activePlayer);
  if (!GAME.winner) {
    winnerLabel.classList.add("hidden");
    winnerLabel.textContent = "";
  } else {
    winnerLabel.classList.remove("hidden");
    winnerLabel.textContent = `${unitToPlayerName(GAME.winner)} wins! (Leader defeated)`;
  }
}

function rerender() {
  renderUnits();
  highlightSelectedAndTargets();
  renderStatus();
}

function switchTurn() {
  GAME.activePlayer = GAME.activePlayer === 1 ? 2 : 1;
  GAME.selectedUnitId = null;
}

function getUnitForSelection() {
  return GAME.units.find((u) => u.id === GAME.selectedUnitId) || null;
}

function checkLeaderDefeat() {
  const leaders = GAME.units.filter((u) => u.type === "L");
  const p1Leader = leaders.find((u) => u.player === 1) || null;
  const p2Leader = leaders.find((u) => u.player === 2) || null;

  if (!p1Leader) return 2;
  if (!p2Leader) return 1;
  return null;
}

function canMoveTo(unit, x, y) {
  if (!withinGrid(x, y)) return false;
  if (!isEmpty(x, y)) return false;
  const def = UNIT_DEFS[unit.type];
  const d = maxDiagDistance(unit.position.x, unit.position.y, x, y);
  return d === def.move;
}

function canAttackTarget(attacker, target) {
  if (!attacker || !target) return false;
  if (attacker.player === target.player) return false;

  const def = UNIT_DEFS[attacker.type];
  if (def.melee) return maxDiagDistance(attacker.position.x, attacker.position.y, target.position.x, target.position.y) === 1;
  if (def.archer) return ChebyshevRange(attacker.position.x, attacker.position.y, target.position.x, target.position.y, def.archerRange[0], def.archerRange[1]);
  return false;
}

function moveSelectedTo(x, y) {
  const unit = getUnitForSelection();
  if (!unit) return false;
  if (unit.player !== GAME.activePlayer) return false;
  if (!canMoveTo(unit, x, y)) return false;

  unit.position = { x, y };
  addLog(`${unitToPlayerName(unit.player)} ${UNIT_DEFS[unit.type].name} moved to (${x},${y})`);
  const winner = checkLeaderDefeat(); // Movement can't kill leaders, but keep logic simple.
  if (winner) {
    GAME.winner = winner;
    GAME.selectedUnitId = null;
  } else {
    switchTurn();
  }

  return true;
}

function attackSelected(attacker, target) {
  if (!canAttackTarget(attacker, target)) return false;

  target.hp -= UNIT_DEFS[attacker.type].damage;
  const attackerName = UNIT_DEFS[attacker.type].name;
  const targetName = UNIT_DEFS[target.type].name;
  addLog(`${unitToPlayerName(attacker.player)} ${attackerName} attacked ${unitToPlayerName(target.player)} ${targetName} (${target.hp <= 0 ? "killed" : `HP now ${target.hp}`})`);

  if (target.hp <= 0) {
    GAME.units = GAME.units.filter((u) => u.id !== target.id);
  }

  const winner = checkLeaderDefeat();
  if (winner) {
    GAME.winner = winner;
    GAME.selectedUnitId = null;
    return true;
  }

  switchTurn();
  return true;
}

function initUnits() {
  GAME.units = [];

  // Player 1 (top). y increases downward.
  // Backline = Leader + Archers, Frontline = Infantry, Flanks = Cavalry.
  GAME.units.push({ id: "p1-L", type: "L", player: 1, hp: UNIT_DEFS.L.hp, position: { x: 3, y: 0 } });
  GAME.units.push({ id: "p1-I-1", type: "I", player: 1, hp: UNIT_DEFS.I.hp, position: { x: 2, y: 2 } });
  GAME.units.push({ id: "p1-I-2", type: "I", player: 1, hp: UNIT_DEFS.I.hp, position: { x: 3, y: 2 } });
  GAME.units.push({ id: "p1-I-3", type: "I", player: 1, hp: UNIT_DEFS.I.hp, position: { x: 4, y: 2 } });
  GAME.units.push({ id: "p1-A-1", type: "A", player: 1, hp: UNIT_DEFS.A.hp, position: { x: 2, y: 1 } });
  GAME.units.push({ id: "p1-A-2", type: "A", player: 1, hp: UNIT_DEFS.A.hp, position: { x: 4, y: 1 } });
  GAME.units.push({ id: "p1-C", type: "C", player: 1, hp: UNIT_DEFS.C.hp, position: { x: 0, y: 2 } });

  // Player 2 (bottom)
  GAME.units.push({ id: "p2-L", type: "L", player: 2, hp: UNIT_DEFS.L.hp, position: { x: 4, y: 7 } });
  GAME.units.push({ id: "p2-I-1", type: "I", player: 2, hp: UNIT_DEFS.I.hp, position: { x: 2, y: 5 } });
  GAME.units.push({ id: "p2-I-2", type: "I", player: 2, hp: UNIT_DEFS.I.hp, position: { x: 3, y: 5 } });
  GAME.units.push({ id: "p2-I-3", type: "I", player: 2, hp: UNIT_DEFS.I.hp, position: { x: 4, y: 5 } });
  GAME.units.push({ id: "p2-A-1", type: "A", player: 2, hp: UNIT_DEFS.A.hp, position: { x: 2, y: 6 } });
  GAME.units.push({ id: "p2-A-2", type: "A", player: 2, hp: UNIT_DEFS.A.hp, position: { x: 4, y: 6 } });
  GAME.units.push({ id: "p2-C", type: "C", player: 2, hp: UNIT_DEFS.C.hp, position: { x: 7, y: 5 } });
}

function resetGame() {
  GAME.activePlayer = 1;
  GAME.winner = null;
  GAME.selectedUnitId = null;
  GAME.units = [];
  GAME.lastAction = "-";
  GAME.actionLog = [];
  initUnits();

  addLog("New game started. P1 to act.");
  rerender();
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
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);

      cell.addEventListener("click", () => {
        const cx = Number(cell.dataset.x);
        const cy = Number(cell.dataset.y);
        const unit = getUnitAt(cx, cy);
        console.log(`Cell clicked: (${cx},${cy}), occupied=${unit ? unit.type : "none"}`);

        if (GAME.winner) return;

        if (unit) {
          // Click your own unit -> select.
          if (unit.player === GAME.activePlayer) {
            if (GAME.selectedUnitId === unit.id) {
              GAME.selectedUnitId = null;
              rerender();
              return;
            }

            GAME.selectedUnitId = unit.id;
            rerender();
            return;
          }

          // Click enemy unit -> attack if you have an active selected unit.
          const attacker = getUnitForSelection();
          if (!attacker || attacker.player !== GAME.activePlayer) return;

          const attacked = attackSelected(attacker, unit);
          if (attacked) rerender();
          return;
        }

        // Click empty cell -> move (if a unit is selected and the move is valid).
        const selected = getUnitForSelection();
        if (!selected) return;
        if (selected.player !== GAME.activePlayer) return;

        const moved = moveSelectedTo(cx, cy);
        if (moved) rerender();
      });

      boardEl.appendChild(cell);
      row.push(cell);
    }
    cellMap.push(row);
  }

  renderUnits();
  highlightSelectedAndTargets();
}

function attachResetButton() {
  // Optional: you can add a reset button later; kept minimal for Phase 1.
}

function initUI() {
  boardEl = document.getElementById("board");
  currentPlayerLabel = document.getElementById("currentPlayerLabel");
  winnerLabel = document.getElementById("winnerLabel");
  lastActionEl = document.getElementById("lastAction");
  actionLogEl = document.getElementById("actionLog");

  renderStatus();
}

function initGameInteractions() {
  // We already attach click handlers per-cell in createBoard().
}

function setupAttackOnEnemyClick() {
  // Requirement: "Click enemy unit in range → attack"
  // We handle this in the same per-cell click handler by treating occupied cells as "unit clicks".
  // The handler currently ignores non-active units for selection, so we need to attempt an attack here.
  // We'll implement by overriding the click behavior: simplest is to add a separate handler on the unit area.
}

function patchBoardClickHandlerForAttacks() {
  // Instead of complicating per-cell listeners, we implement attacks by allowing clicks on enemy units
  // when there's an active selected unit from the current player.
  // We'll do this by adding a single click listener to the board and using event bubbling.
  // To avoid double-handling, we don't remove the per-cell listeners; we rely on this board listener
  // only when the target cell was not handled to return early.
}

function installAttackBehaviorInCellClick() {
  // During creation, the handler already captures unit and returns early for non-active units.
  // To keep changes localized and correct, we actually rework movement/attack in place by refactoring
  // the selection logic. However, we already shipped a version above: we’ll integrate attack behavior
  // by changing the handler at the time of cell creation.
}

function main() {
  initUI();
  createBoard();
  initUnits();
  addLog("New game started. P1 to act.");
  rerender();
}

document.addEventListener("DOMContentLoaded", () => {
  // Ensure UI is ready.
  main();
});

