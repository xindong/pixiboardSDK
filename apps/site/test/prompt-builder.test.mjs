import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderNodePrompt } from '../src/prompt-builder.ts';
import { DEFAULT_PROMPT_SETTINGS } from '../src/ui/prompt-settings.ts';

const image = {
  id: 'n1', type: 'image', x: 0, y: 648, width: 320, height: 320, rotation: 0, zIndex: 0,
  props: { name: 'a.svg', mimeType: 'image/svg+xml', size: 7596, intrinsicWidth: 320, intrinsicHeight: 320 },
  assetRefs: { primary: { assetId: 'asset-1', variant: 'original' } },
};
const context = (nodes, extra = {}) => ({
  boardId: 'b1', revision: 478, node: nodes[0], nodeIds: nodes.map(node => node.id), nodes,
  assets: [], connections: [], truncated: [], ...extra,
});
const contextOf = prompt => JSON.parse(prompt.split('\n').find(line => line.startsWith('{')));

test('default single-node prompt carries identity and useful props only', () => {
  const prompt = renderNodePrompt({ instruction: ' 换成蓝色 ', context: context([image]), resources: [] }, DEFAULT_PROMPT_SETTINGS);
  assert.ok(prompt.startsWith('[画布节点操作]'));
  assert.ok(prompt.endsWith('\n以下是用户的需求和偏好，请根据上下文信息规划如何完成用户的需求。\n[用户的处理偏好和需求]\n换成蓝色'));
  assert.deepEqual(contextOf(prompt), {
    board_id: 'b1', revision: 478,
    nodes: [{ id: 'n1', type: 'image', props: { name: 'a.svg', mimeType: 'image/svg+xml' } }],
  });
  assert.ok(prompt.length < 700, `prompt is ${prompt.length} chars`);
});

test('opt-in geometry and assets omit default state and empty lists', () => {
  const settings = { ...DEFAULT_PROMPT_SETTINGS, includeGeometry: true, includeAssets: true };
  const data = contextOf(renderNodePrompt({ instruction: 'x', context: context([{ ...image, rotation: 15, locked: false }]), resources: [] }, settings));
  assert.deepEqual(data.nodes[0], {
    id: 'n1', type: 'image', x: 0, y: 648, width: 320, height: 320, rotation: 15,
    props: { name: 'a.svg', mimeType: 'image/svg+xml' },
    assetRefs: { primary: { assetId: 'asset-1', variant: 'original' } },
  });
  assert.equal('assets' in data || 'resources' in data || 'connections' in data || 'truncated' in data, false);
});

test('multi-node prompt names the primary node and keeps connections', () => {
  const text = { id: 'n2', type: 'text', props: { text: '字'.repeat(1000) } };
  const data = contextOf(renderNodePrompt({ instruction: 'x', context: context([text, image], {
    connections: [{ source: 'n1', target: 'n2' }], truncated: ['maxChars'],
  }), resources: [] }, DEFAULT_PROMPT_SETTINGS));
  assert.equal(data.node_id, 'n2');
  assert.deepEqual(data.connections, [{ source: 'n1', target: 'n2' }]);
  assert.deepEqual(data.truncated, ['maxChars']);
  assert.ok(data.nodes[0].props.text.length < 700);
  assert.match(data.nodes[0].props.text, /共 1000 字/);
});

test('preferences follow the request in the closing block', () => {
  const settings = { ...DEFAULT_PROMPT_SETTINGS, nodePreferences: ' 修图用 mivo ' };
  const prompt = renderNodePrompt({ instruction: '带娃', context: context([image]), resources: [] }, settings);
  assert.ok(prompt.endsWith('[用户的处理偏好和需求]\n带娃\n修图用 mivo'));
  assert.equal(prompt.includes('[用户的处理偏好]\n'), false);
});
