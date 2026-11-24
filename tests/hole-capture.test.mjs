import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); };

const start = SRC.indexOf('function finishCurrentHole()');
const end = SRC.indexOf('\nfunction simulateRound()', start);
const block = SRC.slice(start, end);

ok(start !== -1 && end !== -1, 'finishCurrentHole() was found in index.html');
ok(/const capturePlayers = \[\]/.test(block), 'capturePlayers array is built in the finish path');
ok(/capturePlayers\.push\(\{/.test(block), 'each player pushes a capture entry');
ok(/name: p\.name/.test(block), 'capture entry carries the player name');
ok(/points: pts/.test(block), 'capture entry carries the hole points');
ok(/firstOn: !!s\.firstOn/.test(block), 'capture entry carries firstOn');
ok(/greenie: !!\(isPar3 && s\.firstOn\)/.test(block), 'capture entry carries greenie');
ok(/closest: !!s\.closest/.test(block), 'capture entry carries closest');
ok(/putt: !!s\.putt/.test(block), 'capture entry carries putt');
ok(/notes: notes\.slice\(\)/.test(block), 'capture entry carries a copy of the note codes');
ok(/runningTotal: getRunningTotal\(p\)/.test(block), 'capture entry carries the running total');
ok(/const carryOut = getCarryInForHole\(currentHole \+ 1\)/.test(block), 'carry-out object is retained');
ok(/const carryTotal = carryOut\.firstOn \+ carryOut\.closest \+ carryOut\.putt \+ carryOut\.greenie/.test(block), 'raw message still uses the carry total');
ok(/const capturePayload = \{/.test(block), 'capture payload is assembled');
ok(/message: shadowMessage/.test(block), 'payload keeps the raw Pushover message');
ok(/matchId: currentMatchId/.test(block), 'payload identifies the round');
ok(/hole: currentHole/.test(block), 'payload identifies the hole');
ok(/par,/.test(block), 'payload identifies the par');
ok(/playerScores: capturePlayers/.test(block), 'payload carries structured player scores');
ok(/carryOut,/.test(block), 'payload carries carry-out components');
ok(/standings,/.test(block), 'payload carries the standings snapshot');
ok(/body: JSON\.stringify\(capturePayload\)/.test(block), 'fetch sends the capture payload');
ok(!/JSON\.stringify\(\{ message: shadowMessage \}\)/.test(block), 'fetch no longer sends a message-only body');
ok(/fetch\('https:\/\/pwa-players-backend\.onrender\.com\/send-walt'/.test(block), 'Pushover shadow endpoint is unchanged');

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);
