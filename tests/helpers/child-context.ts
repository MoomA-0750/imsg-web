import { tmpdir } from 'node:os';
import { buildChildEnv, type ChildContext } from '../../src/server/child-env.js';

/**
 * Tests build a real context through the real builder rather than getting a
 * bypass. A test-only escape hatch would be a hole in the thing being built:
 * the contract exists precisely so that nothing can hand a child an arbitrary
 * environment.
 *
 * The directory must actually exist, because it becomes the child's cwd and
 * spawn fails otherwise -- which is how the first version of this helper was
 * caught using a macOS-only path on Linux.
 */
export function testContext(home = tmpdir()): ChildContext {
  return buildChildEnv({ tmpDir: tmpdir(), cwd: tmpdir(), home });
}
