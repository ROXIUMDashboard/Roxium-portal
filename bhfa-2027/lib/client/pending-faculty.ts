import type { Faculty } from '../domain/types';

/**
 * Faculty changes this browser has made that the server has not confirmed yet.
 *
 * Every save response and every realtime frame carries the whole roster. Laid
 * over the top of it, these keep a status click, a just-added row or a removal
 * on screen while its own request is still in flight — so a slower response to
 * an earlier edit, or a collaborator's change landing mid-save, never flicks
 * someone back to where they were a moment ago.
 */
export class PendingFaculty {
  private patches = new Map<string, { patch: Partial<Faculty>; seq: number }>();
  private created = new Map<string, Faculty>();
  private removed = new Set<string>();
  private seq = 0;

  /** Record an edit; returns a ticket that `settle` uses to clear it. */
  patch(facultyId: string, patch: Partial<Faculty>): () => void {
    const seq = ++this.seq;
    const prior = this.patches.get(facultyId)?.patch;
    this.patches.set(facultyId, { patch: { ...prior, ...patch }, seq });
    // Only the latest edit clears the overlay; an earlier one settling must
    // not drop a later edit that is still on its way.
    return () => {
      if (this.patches.get(facultyId)?.seq === seq) this.patches.delete(facultyId);
    };
  }

  create(member: Faculty): () => void {
    this.created.set(member.id, member);
    return () => this.created.delete(member.id);
  }

  remove(facultyId: string): () => void {
    this.removed.add(facultyId);
    return () => this.removed.delete(facultyId);
  }

  get empty(): boolean {
    return !this.patches.size && !this.created.size && !this.removed.size;
  }

  /** The roster as this browser should show it. */
  overlay(roster: Faculty[]): Faculty[] {
    if (this.empty) return roster;
    const shown = roster
      .filter((f) => !this.removed.has(f.id))
      .map((f) => {
        const pending = this.patches.get(f.id);
        return pending ? { ...f, ...pending.patch } : f;
      });
    const present = new Set(shown.map((f) => f.id));
    for (const member of this.created.values()) {
      if (!present.has(member.id) && !this.removed.has(member.id)) {
        const pending = this.patches.get(member.id);
        shown.push(pending ? { ...member, ...pending.patch } : member);
      }
    }
    return shown;
  }
}
