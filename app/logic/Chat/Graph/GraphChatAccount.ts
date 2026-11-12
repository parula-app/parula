import { ChatAccount } from '../ChatAccount';
import type { GraphAccount } from '../../Mail/Graph/GraphAccount';
import { GraphChatRoom } from './GraphChatRoom';
import type { TGraphChat } from './TGraphChat';
import type { Group } from '../../Abstract/Group';
import { GraphChatPerson } from './GraphChatPerson';
import { ArrayColl, MapColl } from 'svelte-collections';

export class GraphChatAccount extends ChatAccount {
  readonly protocol: string = "chat-graph";
  declare readonly rooms: MapColl<GraphChatPerson | Group, GraphChatRoom>;
  declare readonly roster: ArrayColl<GraphChatPerson>;
  declare protected readonly allPersonsCached: MapColl<string, WeakRef<GraphChatPerson>>;
  declare getPersonUID: (userID: string, name?: string) => GraphChatPerson;

  get account(): GraphAccount {
    return this.mainAccount as GraphAccount;
  }

  protected newPersonUID(userID: string, name?: string): GraphChatPerson {
    return new GraphChatPerson(userID, name);
  }

  async syncOnStartup() {
    await this.listRooms();
  }

  async listRooms(): Promise<void> {
    await super.listRooms();
    let chatsJSON = await this.account.graphGetAll<TGraphChat>("chats", { $top: 50 });
    for (let chatJSON of chatsJSON) {
      let room = this.newRoom();
      room.fromGraph(chatJSON);
      await room.listMembers();
      this.rooms.set(room.contact, room);
    }
  }

  newRoom(): GraphChatRoom {
    return new GraphChatRoom(this);
  }
}
