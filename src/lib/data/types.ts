// データアクセス層の型（data-access.md §2）。Firestore の型を UI に漏らさない
import type { Day } from '../domain/day';

export interface EventDoc {
  id: string;
  name: string;
  startDate: Day;
  endDate: Day;
  floatCash: number;
  ownerUid: string;
  deleting: boolean;
}

/** watchMyEvents の補足。memberOf：自分の members があるイベントのID（表示できないものも含む） */
export interface MyEventsMeta {
  fromCache: boolean;
  memberOf: string[];
}

export type Unsubscribe = () => void;
