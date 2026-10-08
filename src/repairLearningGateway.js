'use strict';

// Circulation owns the boundary between the immune repair actuator and the learning system.
// The repair engine must not import the learning implementation directly: that would create a
// new immune -> learning cable and defeat the fly-by-wire ratchet. This gateway is the circulation
// side of that wire; it carries the already-bounded repair observation into learning custody.
const { snapshotFiles, recordRepairObservations } = require('./repairLearning');

module.exports = { snapshotFiles, recordRepairObservations };
