import type { WorldsGateway } from "../application";
import type { WorldInfoWireV1 } from "../contracts/v1/worlds";
import { decodeTrashedWorldInfoV1, decodeWorldInfoV1 } from "../contracts/v1/worlds";
import { type HttpApplicationState, requestJson, selectWorld } from "./request";

export function createWorldsHttpGateway(state: HttpApplicationState): WorldsGateway {
  return {
    select: (id: string) => {
      selectWorld(state, id);
    },
    list: async () => {
      const wire = await requestJson<{ ok: boolean; worlds: WorldInfoWireV1[] }>("/api/worlds");
      return { ...wire, worlds: wire.worlds.map(decodeWorldInfoV1) };
    },
    listTrash: async () => {
      const wire = await requestJson<{ ok: boolean; worlds: WorldInfoWireV1[] }>(
        "/api/worlds/trash",
      );
      return {
        ...wire,
        worlds: wire.worlds.map(decodeTrashedWorldInfoV1),
      };
    },
    open: async (id: string) => {
      const wire = await requestJson<{ ok: boolean; world: WorldInfoWireV1 }>("/api/worlds/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return { ...wire, world: decodeWorldInfoV1(wire.world) };
    },
    create: async (title: string, backupUrl: string) => {
      const wire = await requestJson<{ ok: boolean; world: WorldInfoWireV1 }>(
        "/api/worlds/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, backupUrl }),
        },
      );
      return { ...wire, world: decodeWorldInfoV1(wire.world) };
    },
    delete: (id: string) =>
      requestJson<{ ok: boolean }>("/api/worlds/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    restore: (id: string) =>
      requestJson<{ ok: boolean }>("/api/worlds/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    purge: (id: string) =>
      requestJson<{ ok: boolean }>("/api/worlds/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }),
  };
}
