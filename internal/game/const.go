package game

const (
	TPS     = 60
	Dt      = 1.0 / 60.0
	ScreenW = 320
	ScreenH = 224
	Tile    = 16

	// Compact test lot (25×18 tiles).
	LotW = 400.0
	LotH = 288.0

	RunSeconds = 60.0 // sandbox clock
	BuzzerTick = 60 * TPS

	DozerBodyR = 14.0
	BladeW     = 32.0
	BladeHDown = 10.0
	BladeHUp   = 6.0
	BladeReach = 18.0

	PlatesMax       = 4
	HeatMax         = 100.0
	HeatCookPush    = 28.0
	HeatCookStall   = 45.0
	HeatCoolAsphalt = 18.0
	HeatCoolIdle    = 8.0

	WreckRateDown = 40.0 // HP/s per overlapped cell, blade-down
	WreckRateUp   = 2.0  // glance

	CruiserSpeed  = 95.0
	CruiserRadius = 8.0
	CruiserKillCash = 25
	FrontAlong    = 4.0

	HitStopTicks = 3
	ShakeDecay   = 8.0
	ShakeOnBreak = 3.5

	DollarLife = 0.9
	DollarRise = 18.0

	HeatVent  = 70.0
	HeatPulse = 90.0

	TurnRateBladeUp   = 2.4
	TurnRateBladeDown = 1.1
	SpeedFwdUp        = 110.0
	SpeedFwdDown      = 48.0
	SpeedRevUp        = 55.0
	SpeedRevDown      = 28.0
	AccelFwd          = 180.0
	AccelBrake        = 220.0
	AccelRev          = 120.0

	SpawnX = 200.0
	SpawnY = 248.0

	StallSpeed = 8.0

	IFramesPeel = 45

	CruiserOffsetF = 22.0
	CruiserOffsetS = 16.0

	DeepRubbleA = 256.0

	TillerDeadzone = 8.0
	ThrottleTravel = 40.0
	TapMoveMax     = 12.0
	TapDurMax      = 0.2

	FragCountWood     = 5
	FragCountBrick    = 6
	FragCountConcrete = 7
	FragCountGlass    = 8
	FragCountSteel    = 4

	TallyRoll = 1.2
)
