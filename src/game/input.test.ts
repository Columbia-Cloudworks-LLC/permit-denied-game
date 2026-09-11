import { describe, expect, it } from 'vitest';
import { Input, stickAxes } from './input';

describe('touch driving input', () => {
  it('has independent dead zones and proportional, bounded axes', () => {
    expect(stickAxes(.15, -.14)).toEqual({ throttle: 0, steer: 0 });
    expect(stickAxes(.575, -.575).throttle).toBeCloseTo(.5);
    expect(stickAxes(.575, -.575).steer).toBeCloseTo(.5);
    expect(stickAxes(-2, 2)).toEqual({ throttle: -1, steer: -1 });
    expect(stickAxes(1, 0)).toEqual({ throttle: 0, steer: 1 });
  });

  it('lets held keyboard directions override only their own axis', () => {
    const input = new Input();
    input.setTouch({ throttle: .4, steer: -.6, blade: true });
    input.down.add('w');
    expect(input.axis()).toEqual({ throttle: 1, steer: -.6 });
    input.down.add('s');
    expect(input.axis().throttle).toBe(0);
    input.down.clear();
    input.down.add('ArrowRight');
    expect(input.axis()).toEqual({ throttle: .4, steer: 1 });
    input.setTouch({ throttle: 0, steer: 0, blade: false });
    expect(input.axis().steer).toBe(1);
  });

  it('combines blade sources and resets all held and pending input', () => {
    const input = new Input();
    input.down.add(' ');
    input.pressed.add('Escape');
    input.setTouch({ throttle: 1, steer: 1, blade: false });
    expect(input.blade()).toBe(true);
    input.down.clear();
    input.setTouch({ throttle: 1, steer: 1, blade: true });
    expect(input.blade()).toBe(true);
    input.reset();
    expect(input.axis()).toEqual({ throttle: 0, steer: 0 });
    expect(input.blade()).toBe(false);
    expect(input.consume('Escape')).toBe(false);
  });
});
