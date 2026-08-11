# Changelog

All notable changes to `@pixi-board/agent-tools` will be documented here.

## Unreleased

- Published for the public beta. The tool contract is transport-agnostic: an
  integrator wires it to MCP, HTTP or direct function calls in whatever shape
  its own agent harness expects.
- Capability errors are now matched with `isCapabilityError()` rather than
  `instanceof`, so an error raised by a board keeps its original code instead of
  being flattened to `INTERNAL_ERROR` when two copies of the capabilities
  package are present.
