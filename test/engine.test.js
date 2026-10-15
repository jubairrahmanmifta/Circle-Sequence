const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateCircles, shuffleArray, sanitizeName, generateRoomCode } = require('../server.js');

describe('Game Engine', () => {
  test('generateCircles produces N unique numbers', () => {
    for (let n = 3; n <= 20; n++) {
      const circles = generateCircles(n);
      assert.strictEqual(circles.length, n);
      const numbers = circles.map(c => c[0]);
      const unique = new Set(numbers);
      assert.strictEqual(unique.size, n);
    }
  });
  
  test('generateCircles has no overlaps', () => {
    // `size` is the circle diameter, so two circles overlap only when the
    // distance between their centres is less than the sum of their radii.
    for (let n = 3; n <= 20; n++) {
      const circles = generateCircles(n);
      for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
          const dist = Math.hypot(circles[i][1] - circles[j][1], circles[i][2] - circles[j][2]);
          const minDist = (circles[i][3] + circles[j][3]) / 2;
          assert(dist > minDist - 0.5, `circles ${i} and ${j} overlap (dist=${dist}, min=${minDist})`);
        }
      }
    }
  });
  
  test('shuffleArray preserves all elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray([...arr]);
    assert.strictEqual(shuffled.length, arr.length);
    for (let n of arr) {
      assert(shuffled.includes(n));
    }
  });
  
  test('sanitizeName removes invalid chars and limits length', () => {
    assert.strictEqual(sanitizeName('Player'), 'Player');
    assert.strictEqual(sanitizeName('Player123'), 'Player123');
    // Exactly 12 chars is allowed; 13 is truncated to 12.
    assert.strictEqual(sanitizeName('Test_Name-Dot'), 'Test_Name-Do');
    assert.strictEqual(sanitizeName('  spaces  '), 'spaces');
    assert.strictEqual(sanitizeName('A'.repeat(20)), 'A'.repeat(12));
    // Tag characters are stripped, then the result is truncated to 12 chars.
    assert.strictEqual(sanitizeName('<script>bad</script>'), 'scriptbadscr');
    assert.strictEqual(sanitizeName('bad<>name'), 'badname');
  });
  
  test('generateRoomCode produces valid format', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      assert.strictEqual(code.length, 5);
      assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code));
    }
  });
});