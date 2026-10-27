# CampusBites feature contract

A feature is two files. The shop and server load them automatically.

## Menu data (ctx.products / view.products)
Each dish: {id, name, detail, category, price (₹ integer), veg (bool), spicy (bool), calories}.
Ids: burger 179, pizza 259, biryani 229, fries 129, roll 169, brownie 119.
Categories: Burgers, Pizza, Indian, Sides, Desserts. Delivery ₹29, free from ₹399.

## site/feature.js (frontend, runs in the browser; pure functions only)
export const feature = {name: 'Short name', slot: 'bag' | 'menu'}  // where the panel shows
export function initialState() -> plain JSON object
export function render(view) -> HTML string for the panel
  - buttons: <button data-action="NAME">Label</button>
  - inputs: <input name="FIELD">, <select name="FIELD">, <input type="checkbox" name="FIELD" data-action="NAME"> (fires on change)
  - wrap rows in <div class="row">; messages in <p class="success"> or <p class="error">
  - ALWAYS escape user text with view.esc(text)
export async function onAction(action, input, view, api) -> new state object
  - input = {FIELD: string, checkbox FIELD: boolean} from the panel
  - api(action, body) POSTs to the backend and resolves to its JSON; it throws on network errors
  - unknown action -> return view.state unchanged
optional export function summaryLines(view) -> [{label, amount}]  // extra bag lines in ₹; negative = discount
optional export function filterProducts(products, view) -> subset of products to show on the menu
view = {items: [{id, name, price, qty, category, veg, spicy}], subtotal, products, state, esc}
There is no bag-change event: render and the hooks are called again with a fresh view whenever the bag changes.
Anything that depends on the bag (totals, discounts, eligibility) must be computed from view.items / view.subtotal
inside render/summaryLines, not stored in state at onAction time (state can keep e.g. the applied code).
Rules: no import, no fetch, no document, no window, no localStorage, no timers.

## api/feature.mjs (backend, runs in Node at POST /api/feature/<action>)
export function handle(action, body, ctx) -> JSON object
  - ctx = {products, store}; store is a plain object kept in memory between requests (mutate it)
  - body may be null or malformed: validate everything
  - never trust prices from the browser: look up prices in ctx.products by id
  - include status: 200 for success, 400 for bad input; unknown action -> {status: 404, error}
Rules: no import, no require, no process, no fs, no fetch, no timers.

## Tests (tests/feature.acceptance.test.mjs, written by QA)
import test from 'node:test';
import assert from 'node:assert/strict';
import {ui, handle, makeView, makeCtx, apiFrom, summaryLines, filterProducts, PRODUCTS} from './helpers.mjs';
- makeView(bag, state?) builds the view, e.g. makeView({pizza: 2, fries: 1}); state defaults to ui.initialState()
- makeCtx() -> fresh {products, store}; apiFrom(ctx) -> the api() function wired to the real handle()
- summaryLines(ui, view) / filterProducts(ui, PRODUCTS, view) call the optional hooks safely
- name backend tests 'API: ...' and frontend tests 'UI: ...'
Example:
test('UI: applying adds a line', async () => {
  const ctx = makeCtx(); const view = makeView({pizza: 1});
  const state = await ui.onAction('apply', {code: 'X'}, view, apiFrom(ctx));
  assert.equal(summaryLines(ui, makeView({pizza: 1}, state)).length, 1);
});
