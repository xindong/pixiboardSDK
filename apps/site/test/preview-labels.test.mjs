import assert from "node:assert/strict";
import test from "node:test";
import { previewTypeLabelFor } from "../src/preview-labels.ts";

test("archive without a model is labelled ZIP, ordinary model archives keep 3D", () => {
  const model = { type: "model", name: "scene.ZIP", props: { previewStatus: "failed" } };
  assert.equal(previewTypeLabelFor(model, "3D"), "3D:暂无预览");
  assert.equal(previewTypeLabelFor({ ...model, props: { ...model.props, previewError: "ZIP_NO_MODEL: none" } }, "3D"), "ZIP:暂无预览");
  assert.equal(previewTypeLabelFor({ type: "file", props: { fileExtension: "ZiP", previewStatus: "queued" } }, "文件"), "ZIP:预览生成中");
  assert.equal(previewTypeLabelFor({ type: "file", name: "archive.ZIP" }, "文件"), "ZIP");
  assert.equal(previewTypeLabelFor({ type: "file", name: "old.zip", props: { name: "renamed.pdf" } }, "PDF"), "PDF");
});
