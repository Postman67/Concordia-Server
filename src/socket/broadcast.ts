import { Server } from 'socket.io';

let _io: Server | null = null;

export function setIO(io: Server): void {
  _io = io;
}

/** Broadcast an event to every connected client on this server. */
export function broadcast(event: string, data: unknown): void {
  _io?.emit(event, data);
}
