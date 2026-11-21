import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthLoadingGate} from '../../src/utils/authLoadingGate.js';

test('initial auth, account switch and signout block routes; same-account token renewal preserves them',()=>{
 const blocks=createAuthLoadingGate();
 assert.equal(blocks(null),true);assert.equal(blocks({uid:'one'}),true);
 assert.equal(blocks({uid:'one',accessToken:'refreshed'}),false);
 assert.equal(blocks({uid:'two'}),true);assert.equal(blocks(null),true);
});
