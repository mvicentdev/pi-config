// node --test extensions/cache-retention/index.test.mjs
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import cacheRetention from "./index.ts";

const original = process.env.PI_CACHE_RETENTION;
beforeEach(() => delete process.env.PI_CACHE_RETENTION);
afterEach(() => {
	if (original === undefined) delete process.env.PI_CACHE_RETENTION;
	else process.env.PI_CACHE_RETENTION = original;
});

test("pide la caché larga cuando el usuario no fija ninguna", () => {
	cacheRetention({});
	assert.equal(process.env.PI_CACHE_RETENTION, "long");
});

test("respeta un PI_CACHE_RETENTION que el usuario ya fijó", () => {
	process.env.PI_CACHE_RETENTION = "short";
	cacheRetention({});
	assert.equal(process.env.PI_CACHE_RETENTION, "short");
});
