// shared/datahubAdapter.test.js
"use strict";

/**
 * Quick test for datahub adapter
 * Run with: node shared/datahubAdapter.test.js
 */

const { adaptDatahubResponse } = require("./datahubAdapter");

// Test data
const testCases = [
  {
    name: "GET list (auto-detect)",
    input: {
      ok: true,
      data: [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ],
      count: 2,
      total: 2,
      limit: 100,
      offset: 0,
    },
    expected: {
      items: [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
      ],
      count: 2,
    },
    type: "auto",
  },
  {
    name: "GET single (auto-detect)",
    input: {
      ok: true,
      data: { id: 123, rule_id: 1, enabled: true },
    },
    expected: { id: 123, rule_id: 1, enabled: true },
    type: "auto",
  },
  {
    name: "POST (auto-detect)",
    input: {
      ok: true,
      insertedId: 456,
      data: { id: 456, rule_id: 2 },
    },
    expected: { id: 456, rule_id: 2 },
    type: "auto",
  },
  {
    name: "PUT (auto-detect)",
    input: {
      ok: true,
      affectedRows: 1,
      data: { id: 123, enabled: false },
    },
    expected: { id: 123, enabled: false },
    type: "auto",
  },
  {
    name: "DELETE (auto-detect)",
    input: {
      ok: true,
      affectedRows: 1,
    },
    expected: { affectedRows: 1 },
    type: "auto",
  },
  {
    name: "DBManager format (passthrough)",
    input: {
      items: [{ id: 1 }, { id: 2 }],
      count: 2,
    },
    expected: {
      items: [{ id: 1 }, { id: 2 }],
      count: 2,
    },
    type: "auto",
  },
];

// Run tests
console.log("🧪 Testing datahub adapter...\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const result = adaptDatahubResponse(test.input, { type: test.type });
  const resultStr = JSON.stringify(result);
  const expectedStr = JSON.stringify(test.expected);

  if (resultStr === expectedStr) {
    console.log(`✅ ${test.name}`);
    passed++;
  } else {
    console.log(`❌ ${test.name}`);
    console.log(`   Expected: ${expectedStr}`);
    console.log(`   Got:      ${resultStr}`);
    failed++;
  }
}

console.log(`\n${passed}/${testCases.length} tests passed`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} tests failed`);
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!");
  process.exit(0);
}
