import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAGIC_LINK_TEMPLATE } from './supabase-auth-config.mjs';

test('sign-in email sends a code for the app without a link that can consume it', () => {
  assert.match(MAGIC_LINK_TEMPLATE, /{{\s*\.Token\s*}}/);
  assert.match(MAGIC_LINK_TEMPLATE, /claude-mons app/);
  assert.doesNotMatch(
    MAGIC_LINK_TEMPLATE,
    /<a\b|href\s*=|\.(?:ConfirmationURL|TokenHash|SiteURL|RedirectTo)\b/i,
  );
});
