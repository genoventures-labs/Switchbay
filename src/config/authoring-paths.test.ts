import { expect, test } from "bun:test";
import { engineAuthoringPath, pluginAuthoringPath, skillAuthoringPath } from "./authoring-paths";

test("shared assets resolve into their committable source repositories", () => {
  expect(engineAuthoringPath({ id: "python-helper", name: "Python Helper", commands: "python3 runner.py" }))
    .toEndWith("Switchbay Engines/engines/Python/PythonHelper/python_helper.engine.json");
  expect(skillAuthoringPath("release-check")).toEndWith("Engine Toolboxes/skills/release-check.skill.md");
  expect(pluginAuthoringPath("repo-ops")).toEndWith("Switchbay/plugins/repo-ops/plugin.json");
});
