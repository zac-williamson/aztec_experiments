// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.27;
import {RootPublisher} from "./PortalV1.t.sol";

/// Test-only controlled root publisher; no rollup proof verification.
/// The version getter supplies the interface exercised by the real monitor.
contract MonitorRootPublisher is RootPublisher {
    uint256 private immutable monitorVersion;
    constructor(uint256 version) RootPublisher(version) { monitorVersion = version; }
    function getVersion() external view returns (uint256) { return monitorVersion; }
}
