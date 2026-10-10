import assert from "node:assert/strict";
import { test } from "node:test";
import { notify, dismissNotice, getNotices, getServerNotices, subscribeNotices } from "./notifications.ts";

test("blank messages do not enter the notification queue", () => {
  assert.equal(notify("  "), 0);
  assert.deepEqual(getServerNotices(), []);
});
test("duplicate errors share a toast and dismiss both owners once", () => {
  let first = 0, second = 0, updates = 0;
  const unsubscribe = subscribeNotices(() => updates++);
  const id = notify("connection rejected", "error", { onDismiss: () => first++ });
  assert.equal(notify("connection rejected", "warning", { onDismiss: () => second++ }), id);
  assert.equal(getNotices().length, 1);
  assert.equal(getNotices()[0].duration, 10000);
  dismissNotice(id); dismissNotice(id);
  assert.equal(first, 1); assert.equal(second, 1); assert.equal(updates, 2);
  unsubscribe();
});
test("dismissal preserves queued messages and uses a new id on retry", () => {
  const first = notify("first", "info");
  const next = notify("second", "success");
  dismissNotice(first);
  assert.deepEqual(getNotices().map(notice => notice.id), [next]);
  const retry = notify("first", "error");
  assert.notEqual(retry, first);
  dismissNotice(next); dismissNotice(retry);
  assert.deepEqual(getNotices(), []);
});
