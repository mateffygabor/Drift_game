// Top-down (2D) car physics underneath the 3D rendering.
//
// The car's velocity is split into a "forward" (vf) and a "lateral"
// (vl, sliding) component. The lateral component is killed by grip; when grip
// drops, the car slides sideways - it drifts.
//
// - AUTOMATIC GEARBOX, 6 gears: low gears pull harder; on every upshift the
//   drive is cut for a moment and a little speed is lost. Shifting is automatic
//   because the controller has no spare buttons.
// - PROGRESSIVE BRAKE: a short tap = gentle slowing, holding it brakes harder
//   and harder, so braking before a corner can be dosed.
// - EASIER DRIFT: brake + steer together at speed puts the car into "drift
//   mode": the rear wheels let go, the brake barely slows down and the car
//   turns in more. Gas + steering holds the drift, countersteering regains
//   grip. How easy it is can be set (carSettings.driftAssist).
// - SMOOTHED STEERING: a digital button turns the wheel fully in ~0.15 s,
//   not instantly.

// Multipliers set in the menu (main.js).
export const carSettings = {
  speedMult: 1,        // top speed / force multiplier
  sensitivityMult: 0.8, // steering (1.0 = the old 90% value, the maximum)
  driftAssist: 0.6,    // 0..1, how easy it is to drift
};

export const CAR_TUNING = {
  maxSpeed: 460,          // top speed (units/s) with 1.0 multipliers
  // --- engine + gearbox ---
  engineAccel: 95,        // base driving force at 1.0 torque
  gearTops: [0.19, 0.34, 0.5, 0.66, 0.83, 1.0],   // top speed of each gear (fraction of the max)
  gearTorque: [2.6, 2.0, 1.55, 1.25, 1.02, 0.9],  // torque multiplier of each gear
  upshiftRpm: 0.97,
  downshiftRpm: 0.82,     // relative to the rpm of the lower gear
  shiftTime: 0.26,        // s, no drive for this long while shifting
  shiftSpeedLoss: 0.012,  // speed fraction lost on each upshift
  aeroDrag: 0.00016,
  rollingDrag: 0.05,
  engineBrake: 55,        // when lifting off (stronger in low gears)
  // --- brake ---
  brakeMax: 760,
  brakeStart: 0.1,        // the brake starts at this pressure (0..1)...
  brakeRamp: 1.15,        // ...and builds up by this much per second
  reverseAccel: 240,
  maxReverseSpeed: 150,
  reverseDelay: 0.35,     // s of braking at standstill before reversing
  // --- steering ---
  turnRate: 2.7,          // rad/s (the old 3.0 * 0.9)
  turnRefSpeed: 195,
  minTurnFactor: 0.25,
  steerRamp: 6.5,         // 1/s
  // --- grip / drift ---
  gripNormal: 9.5,
  gripSpeedLoss: 3.0,
  gripMin: 0.7,
  brakeGripLoss: 1.5,     // plain braking (in a straight line) also loosens grip a little
  driftMinSpeed: 110,     // above this speed brake + steer starts a drift
  driftGripLoss: 8.0,     // grip lost in drift mode (scaled by the assist)
  driftBrakeMult: 0.35,   // fraction of the brake force left in drift mode
  driftYawBoost: 0.45,    // how much faster the car rotates in drift mode
  maxSlipAngle: 0.8,      // rad (~45°), the drift never gets more sideways than this
  driftTransfer: 0.75,    // fraction of the lost slide speed turned into forward speed while drifting
  driftSustainLoss: 5.0,  // drift held with gas + steering
  countersteerGrip: 3.0,  // countersteering gives grip back
  // --- off track ---
  offTrackGripMult: 0.55,
  offTrackForceMult: 0.55,
  offTrackMaxSpeedMult: 0.6,
  gravity: 98,
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Car {
  constructor(vehicle, x = 0, y = 0, angle = 0) {
    this.vehicle = vehicle;
    this.stats = vehicle.stats;
    this.length = vehicle.dims.length;
    this.width = vehicle.dims.width;
    this.collisionRadius = (vehicle.dims.length + vehicle.dims.width) / 4.1;
    this.mass = vehicle.stats.mass;
    this.powerMult = 1;          // set by the difficulty for bots
    this.driftAssistOverride = null;
    this.reset(x, y, angle);
  }

  reset(x, y, angle = 0) {
    this.x = x; this.y = y; this.angle = angle;
    this.vx = 0; this.vy = 0;
    this.driftAmount = 0;
    this.throttle = 0;
    this.braking = false;
    this.steer = 0;
    this.steerVisual = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.offTrack = false;
    this.accelLong = 0;
    this.accelLat = 0;
    this.wheelSpin = 0;
    this.gear = 0;
    this.targetGear = 0;
    this.shiftTimer = 0;
    this.rpm = 0.12;
    this.brakeHeld = 0;
    this.stoppedBrake = 0;
    this.reversing = false;
    this.driftMode = false;
  }

  get maxSpeed() {
    return CAR_TUNING.maxSpeed * carSettings.speedMult * this.powerMult * this.stats.topSpeed;
  }

  get shifting() { return this.shiftTimer > 0; }

  // For the display: 'R' or 1..6
  get displayGear() {
    if (this.reversing) return 'R';
    return String(this.gear + 1);
  }

  _gearTop(g, maxSpeedBase) {
    return CAR_TUNING.gearTops[g] * maxSpeedBase;
  }

  // Automatic gearbox. Returns whether an upshift just started.
  _updateGearbox(dt, vf, gasOn, maxSpeedBase) {
    const T = CAR_TUNING;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) { this.shiftTimer = 0; this.gear = this.targetGear; }
      return false;
    }
    const top = this._gearTop(this.gear, maxSpeedBase);
    const rpm = vf / top;
    if (gasOn && rpm >= T.upshiftRpm && this.gear < T.gearTops.length - 1) {
      this.targetGear = this.gear + 1;
      // smaller, lighter vehicles shift faster
      this.shiftTimer = T.shiftTime * clamp(this.mass, 0.6, 1.4);
      return true;
    }
    while (this.gear > 0 && vf < this._gearTop(this.gear - 1, maxSpeedBase) * T.downshiftRpm) this.gear--;
    return false;
  }

  // slope: track gradient in the driving direction (dh/ds)
  update(dt, input, offTrack, slope = 0) {
    const T = CAR_TUNING;
    const S = this.stats;
    const sm = carSettings.speedMult * this.powerMult;
    const assist = this.driftAssistOverride ?? carSettings.driftAssist;
    const turnRate = T.turnRate * carSettings.sensitivityMult * S.turn;
    const maxSpeedBase = T.maxSpeed * sm * S.topSpeed;
    const turnRefSpeed = T.turnRefSpeed * carSettings.speedMult;
    const offPenalty = (m) => m + (1 - m) * S.offroad;
    const forceMult = offTrack ? offPenalty(T.offTrackForceMult) : 1;
    const maxSpeed = maxSpeedBase * (offTrack ? offPenalty(T.offTrackMaxSpeedMult) : 1);

    this.offTrack = offTrack;
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const rx = -Math.sin(this.angle), ry = Math.cos(this.angle);
    let vf = this.vx * fx + this.vy * fy;
    let vl = this.vx * rx + this.vy * ry;
    const vfBefore = vf, vlBefore = vl;

    // --- smoothed steering ---
    const steerTarget = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const rate = steerTarget === 0 ? T.steerRamp * 1.6 : T.steerRamp;
    this.steer += clamp(steerTarget - this.steer, -rate * dt, rate * dt);
    const steer = this.steer;

    const gasOn = input.gas && !input.brake;
    const brakeOn = input.brake && !input.gas;
    this.brakeHeld = input.brake ? this.brakeHeld + dt : 0;
    const pressure = Math.min(1, T.brakeStart + this.brakeHeld * T.brakeRamp);
    this.driftMode = input.brake && Math.abs(steer) > 0.3 && vf > T.driftMinSpeed * carSettings.speedMult;

    // --- gearbox ---
    if (this._updateGearbox(dt, Math.max(0, vf), gasOn, maxSpeedBase)) vf *= 1 - T.shiftSpeedLoss;
    const g = this.gear;
    const gearRpm = Math.max(0, vf) / this._gearTop(g, maxSpeedBase);

    // --- longitudinal forces ---
    let acc = 0;
    if (input.gas && input.brake) {
      acc = -Math.sign(vf) * T.brakeMax * 0.3 * sm;
    } else if (gasOn) {
      this.stoppedBrake = 0;
      if (vf < -5) {
        acc = T.brakeMax * 0.6 * sm; // gas while rolling backwards: stop first
      } else if (!this.shifting && gearRpm < 1) {
        const curve = 0.8 + 0.25 * Math.sin(Math.PI * Math.min(1, gearRpm));
        acc = T.engineAccel * sm * S.accel * T.gearTorque[g] * curve * forceMult;
      }
    } else if (brakeOn) {
      if (vf > 3) {
        this.stoppedBrake = 0;
        acc = -T.brakeMax * sm * pressure * (this.driftMode ? T.driftBrakeMult : 1) * (offTrack ? 0.8 : 1);
      } else {
        this.stoppedBrake += dt;
        if (this.stoppedBrake > T.reverseDelay) acc = -T.reverseAccel * sm * forceMult;
        else if (vf > -3) vf = 0;
      }
    } else {
      this.stoppedBrake = 0;
      // engine braking: stronger in low gears
      if (Math.abs(vf) > 2) acc = -Math.sign(vf) * T.engineBrake * sm * (0.35 + 0.4 * T.gearTorque[g] / T.gearTorque[0]);
      else vf = 0;
    }
    acc -= Math.sign(vf) * ((T.aeroDrag / sm) * vf * vf + T.rollingDrag * Math.abs(vf));
    acc -= T.gravity * slope;
    const vfPrev = vf;
    vf += acc * dt;
    if (brakeOn && vfPrev > 0 && vf < 0) vf = 0; // the brake doesn't reverse the direction
    if (!gasOn && !brakeOn && Math.sign(vf) !== Math.sign(vfPrev) && vfPrev !== 0) vf = 0;
    if (vf > maxSpeed) vf = Math.max(maxSpeed, vf - 400 * dt);
    vf = Math.max(-T.maxReverseSpeed * sm, vf);
    this.reversing = vf < -5;
    if (this.reversing) { this.gear = 0; this.shiftTimer = 0; }

    // --- steering ---
    const slip = vf > 20 ? Math.atan2(vl, vf) : 0; // slip angle (+ = sliding to the right)
    if (steer !== 0) {
      const speedFactor = Math.max(T.minTurnFactor, Math.min(1, Math.abs(vf) / turnRefSpeed));
      const dir = vf >= 0 ? 1 : -1;
      let boost = this.driftMode ? 1 + T.driftYawBoost * assist * S.drift : 1;
      // if steering would increase the slide past a limit, the car stops rotating - it can't spin out
      const increasesSlip = Math.sign(steer) === -Math.sign(slip);
      if (increasesSlip && Math.abs(slip) > T.maxSlipAngle * 0.7) {
        boost *= Math.max(0.1, 1 - (Math.abs(slip) - T.maxSlipAngle * 0.7) / (T.maxSlipAngle * 0.3));
      }
      this.angle += steer * turnRate * speedFactor * dir * boost * dt;
    }

    // --- lateral grip / drift ---
    const speedRatio = Math.min(1, Math.abs(vf) / maxSpeedBase);
    let grip = T.gripNormal * S.grip - speedRatio * T.gripSpeedLoss;
    const slideDir = Math.sign(vl);          // which way the car slides (+ = right)
    const steerDir = Math.sign(steer);
    if (this.driftMode) {
      grip -= T.driftGripLoss * (0.5 + assist) * S.drift;
    } else if (input.brake && Math.abs(vf) > 5) {
      grip -= T.brakeGripLoss * S.drift;
    }
    const sliding = this.driftAmount > 0.3 && vf > 60;
    if (sliding && steerDir !== 0) {
      if (steerDir === -slideDir && input.gas) {
        // holding the drift: gas, steering into the corner
        grip -= T.driftSustainLoss * assist * S.drift;
      } else if (steerDir === slideDir) {
        // countersteering
        grip += T.countersteerGrip;
      }
    }
    if (offTrack) grip *= offPenalty(T.offTrackGripMult);
    grip = Math.max(T.gripMin, grip);
    const lost = vl * (1 - Math.exp(-grip * dt));
    vl -= lost;
    // while drifting most of the slide turns into forward speed (it is not lost),
    // so the momentum is kept after the corner
    if ((this.driftMode || sliding) && vf > 0) {
      const speedBefore = Math.hypot(vf, vl + lost);
      vf += Math.abs(lost) * T.driftTransfer * (0.6 + 0.4 * assist);
      const after = Math.hypot(vf, vl);
      if (after > speedBefore) vf *= speedBefore / after;
    }

    const totalSpeed = Math.max(1, Math.hypot(vf, vl));
    this.driftAmount = Math.min(1, (Math.abs(vl) / totalSpeed) * 2.2);

    this.vx = vf * fx + vl * rx;
    this.vy = vf * fy + vl * ry;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // --- display / sound ---
    const k = 1 - Math.exp(-dt * 8);
    this.throttle += ((gasOn && !this.shifting ? 1 : 0) - this.throttle) * k;
    this.braking = !!input.brake && vf > 5;
    this.steerVisual = steer;
    this.forwardSpeed = vf;
    this.lateralSpeed = vl;
    // rpm: within the gear; standing still the gas pedal revs it
    const targetRpm = Math.abs(vf) < 8 ? 0.12 + (input.gas ? 0.5 : 0) : clamp(Math.abs(vf) / this._gearTop(g, maxSpeedBase), 0.15, 1.02);
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-dt * (this.shifting ? 14 : 10)));
    if (dt > 0) {
      const kA = 1 - Math.exp(-dt * 6);
      this.accelLong += ((vf - vfBefore) / dt - this.accelLong) * kA;
      const yawRate = steer * turnRate * Math.max(T.minTurnFactor, Math.min(1, Math.abs(vf) / turnRefSpeed));
      this.accelLat += (vf * yawRate * 0.5 + ((vl - vlBefore) / dt) * 0.2 - this.accelLat) * kA;
    }
    this.wheelSpin += (vf / 10 / 0.33) * dt;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}
