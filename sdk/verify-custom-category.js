#!/usr/bin/env node
/**
 * Manual verification script for Custom category feature (issue #478).
 * This script verifies that:
 * 1. serializeMerchantCategory correctly produces XDR for unit and Custom variants
 * 2. Round-trip serialization works correctly
 */

const { xdr, scValToNative } = require('@stellar/stellar-sdk');

/**
 * Serialize a MerchantCategory value to XDR ScVal (copied from client.ts).
 */
function serializeMerchantCategory(category) {
  if (typeof category === "string") {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(category)]);
  }
  // { Custom: string }
  const label = category.Custom;
  if (!label || label.length === 0) {
    throw new Error("MerchantCategory.Custom label must not be empty.");
  }
  if (label.length > 32) {
    throw new Error(
      `MerchantCategory.Custom label must be at most 32 characters (got ${label.length}).`
    );
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Custom"),
    xdr.ScVal.scvString(label),
  ]);
}

console.log('=== Verifying MerchantCategory Custom variant implementation ===\n');

// Test 1: Unit variant (Retail)
console.log('Test 1: Unit variant "Retail"');
try {
  const retailScVal = serializeMerchantCategory('Retail');
  console.log(`  ✓ Serialized successfully`);
  console.log(`    XDR type: ${retailScVal.switch().name}`);
  const vec = retailScVal.vec();
  console.log(`    Vec length: ${vec.length}`);
  console.log(`    Vec[0]: ${vec[0].switch().name} = "${vec[0].sym().toString()}"`);
  
  const native = scValToNative(retailScVal);
  console.log(`  ✓ Round-trip: ${JSON.stringify(native)}`);
  if (JSON.stringify(native) === '["Retail"]') {
    console.log('  ✓ PASS\n');
  } else {
    console.log('  ✗ FAIL: expected ["Retail"]\n');
    process.exit(1);
  }
} catch (e) {
  console.log(`  ✗ FAIL: ${e.message}\n`);
  process.exit(1);
}

// Test 2: Custom variant
console.log('Test 2: Custom variant { Custom: "Handmade" }');
try {
  const customScVal = serializeMerchantCategory({ Custom: 'Handmade' });
  console.log(`  ✓ Serialized successfully`);
  console.log(`    XDR type: ${customScVal.switch().name}`);
  const vec = customScVal.vec();
  console.log(`    Vec length: ${vec.length}`);
  console.log(`    Vec[0]: ${vec[0].switch().name} = "${vec[0].sym().toString()}"`);
  console.log(`    Vec[1]: ${vec[1].switch().name} = "${vec[1].str().toString()}"`);
  
  const native = scValToNative(customScVal);
  console.log(`  ✓ Round-trip: ${JSON.stringify(native)}`);
  if (JSON.stringify(native) === '["Custom","Handmade"]') {
    console.log('  ✓ PASS\n');
  } else {
    console.log('  ✗ FAIL: expected ["Custom","Handmade"]\n');
    process.exit(1);
  }
} catch (e) {
  console.log(`  ✗ FAIL: ${e.message}\n`);
  process.exit(1);
}

// Test 3: All unit variants
console.log('Test 3: All unit variants');
const units = ['Retail', 'Food', 'Services', 'Digital', 'Other'];
for (const variant of units) {
  try {
    const scVal = serializeMerchantCategory(variant);
    const native = scValToNative(scVal);
    if (JSON.stringify(native) !== `["${variant}"]`) {
      console.log(`  ✗ FAIL: ${variant} round-trip failed`);
      process.exit(1);
    }
  } catch (e) {
    console.log(`  ✗ FAIL: ${variant} serialization failed: ${e.message}`);
    process.exit(1);
  }
}
console.log('  ✓ All unit variants PASS\n');

// Test 4: Validation — empty Custom label
console.log('Test 4: Validation — empty Custom label');
try {
  serializeMerchantCategory({ Custom: '' });
  console.log('  ✗ FAIL: should have thrown\n');
  process.exit(1);
} catch (e) {
  if (e.message.match(/empty/i)) {
    console.log(`  ✓ PASS: correctly rejected empty label\n`);
  } else {
    console.log(`  ✗ FAIL: wrong error message: ${e.message}\n`);
    process.exit(1);
  }
}

// Test 5: Validation — label too long
console.log('Test 5: Validation — label exceeds 32 characters');
try {
  serializeMerchantCategory({ Custom: 'a'.repeat(33) });
  console.log('  ✗ FAIL: should have thrown\n');
  process.exit(1);
} catch (e) {
  if (e.message.match(/32/)) {
    console.log(`  ✓ PASS: correctly rejected long label\n`);
  } else {
    console.log(`  ✗ FAIL: wrong error message: ${e.message}\n`);
    process.exit(1);
  }
}

// Test 6: Boundary — exactly 32 characters
console.log('Test 6: Boundary — Custom label exactly 32 characters');
try {
  const label = 'a'.repeat(32);
  const scVal = serializeMerchantCategory({ Custom: label });
  const native = scValToNative(scVal);
  if (native[1] === label) {
    console.log('  ✓ PASS\n');
  } else {
    console.log('  ✗ FAIL: label mismatch\n');
    process.exit(1);
  }
} catch (e) {
  console.log(`  ✗ FAIL: ${e.message}\n`);
  process.exit(1);
}

console.log('=== All tests passed! ===');
console.log('\n✅ MerchantCategory Custom variant implementation is correct.');
console.log('✅ XDR serialization produces the expected ScVec format.');
console.log('✅ Round-trip deserialization works correctly.');
console.log('✅ Validation rules are enforced.\n');
