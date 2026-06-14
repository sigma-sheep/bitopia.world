import { describe, it, expect } from "vitest";
import { RoomStore } from "./store";
import type { Entity } from "shared/types";

function entity(id: string): Entity {
  return {
    id,
    type: "player",
    roomId: "lobby",
    pos: { x: 1, y: 1 },
    facing: "S",
    displayName: id,
    avatarSeed: id,
    address: id,
  };
}

describe("RoomStore", () => {
  it("starts empty", () => {
    expect(new RoomStore().list()).toEqual([]);
  });

  it("lists entities that were added", () => {
    const store = new RoomStore();
    const a = entity("a");
    const b = entity("b");
    store.add(a);
    store.add(b);
    expect(store.list()).toEqual([a, b]);
  });

  it("remove drops the entity and returns it", () => {
    const store = new RoomStore();
    const a = entity("a");
    store.add(a);
    expect(store.remove("a")).toEqual(a);
    expect(store.list()).toEqual([]);
  });

  it("remove returns undefined for an unknown id", () => {
    expect(new RoomStore().remove("nope")).toBeUndefined();
  });

  it("update patches an existing entity and returns it", () => {
    const store = new RoomStore();
    store.add(entity("a"));
    const updated = store.update("a", { pos: { x: 5, y: 6 }, facing: "E" });
    expect(updated).toMatchObject({ id: "a", pos: { x: 5, y: 6 }, facing: "E" });
    expect(store.list()[0]).toMatchObject({ pos: { x: 5, y: 6 }, facing: "E" });
  });

  it("update preserves insertion order", () => {
    const store = new RoomStore();
    store.add(entity("a"));
    store.add(entity("b"));
    store.update("a", { facing: "N" });
    expect(store.list().map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("update returns undefined for an unknown id", () => {
    expect(new RoomStore().update("nope", { facing: "N" })).toBeUndefined();
  });
});
