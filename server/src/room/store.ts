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

  list(): Entity[] {
    return [...this.entities.values()];
  }
}
