/** A county processing fee. It never changes permits, upgrades, or simulation state. */
export class Resubmission {
  used = false;

  charge(cash: number, random = Math.random): number | null {
    if (this.used || cash < 1) return null;
    this.used = true;
    return Math.min(Math.floor(cash), Math.max(1, Math.floor(cash * (.1 + random() * .2))));
  }
}
