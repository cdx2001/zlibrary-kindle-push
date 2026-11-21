import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateSettings } from '../scripts/build.mjs';

test('central size settings reject unsafe or accidental secret fields',()=>{
  assert.equal(validateSettings({maxFileMB:20}).maxFileMB,20);
  for(const config of [{maxFileMB:0},{maxFileMB:51},{maxFileMB:1.5},{maxFileMB:50,API_TOKEN:'oops'}])assert.throws(()=>validateSettings(config));
});
test('one-click manifest contains SQLite binding, required secret names and no secret values',async()=>{
  const cf=JSON.parse(await fs.readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.deepEqual(cf.secrets.required,['API_TOKEN','SMTP_USER','SMTP_AUTH_CODE','KINDLE_EMAIL']);
  assert.equal(cf.durable_objects.bindings[0].class_name,'MailSender');
  assert.deepEqual(cf.migrations[0].new_sqlite_classes,['MailSender']);
  const example=await fs.readFile(new URL('../.dev.vars.example',import.meta.url),'utf8');
  for(const line of example.split(/\r?\n/).filter(s=>s&&!s.startsWith('#')))assert(/^[A-Z_]+=$/.test(line));
});
