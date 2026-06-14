import type { Entity } from "shared/types";

// In-memory presence for the single default room. No persistence this pass —
// state lives only as long as the server process. Insertion order is preserved
// so `list()` is stable (handy for tests and deterministic snapshots).
export class RoomStore {
  private readonly entities = new Map<string, Entity>();

  add(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  // Returns the removed entity so the caller can broadcast who left.
  remove(id: string): Entity | undefined {
    const entity = this.entities.get(id);
    this.entities.delete(id);
    return entity;
  }

  // Apply a partial patch to an existing entity; returns the updated entity, or
  // undefined if the id is unknown (so the caller can ignore stale/forged ids).
  // Re-setting an existing key preserves insertion order, keeping list() stable.
  update(id: string, patch: Partial<Entity>): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    const next = { ...entity, ...patch };
    this.entities.set(id, next);
    return next;
  }

  list(): Entity[] {
    return [...this.entities.values()];
  }
}
