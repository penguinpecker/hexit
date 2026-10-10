// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// SPEC §6 in Solidity: line-for-line port of programs/hexit/src/hexgeo.rs (i128 -> int256). Integers only.
/// Magnitudes stay below ~1e35 (BTC rows), far inside int256, so the maths is unchecked.
library HexGeo {
    /// Hex span of column k, rounded outward (SPEC §4 notation).
    function tLo(uint256 k) internal pure returns (int256) { unchecked { return int256(k) * 5000 - 834; } }
    function tHi(uint256 k) internal pure returns (int256) { unchecked { return int256(k) * 5000 + 5834; } }

    function floorDiv(int256 a, int256 b) internal pure returns (int256 q) {
        unchecked { q = a / b; if (a % b != 0 && ((a < 0) != (b < 0))) q -= 1; }
    }
    function ceilDiv(int256 a, int256 b) internal pure returns (int256) { unchecked { return -floorDiv(-a, b); } }

    function _con(uint256 i, int256 r) private pure returns (int256, int256, int256) {
        unchecked {
            if (i == 0) return (0, 1, r);
            if (i == 1) return (0, -1, r);
            int256 r3 = 3 * r;
            int256 c = 10000 * r;
            if (i == 2) return (r3, 5000, c);
            if (i == 3) return (r3, -5000, c);
            if (i == 4) return (-r3, 5000, c);
            return (-r3, -5000, c);
        }
    }

    /// seg_hits_int: does segment (t0,p0)->(t1,p1) touch hex (k,j)? Edges count. Cyrus-Beck, fractions cross-multiplied.
    function segHits(int256 t0, int256 p0, int256 t1, int256 p1, int256 k, int256 j, int256 r) internal pure returns (bool) {
        unchecked {
            int256 tc = k * 5000 + 2500;
            int256 pc2 = (k & 1) == 0 ? (2 * j + 1) * r : (2 * j + 2) * r;
            int256 x0 = t0 - tc;
            int256 y0 = 2 * p0 - pc2;
            int256 x1 = t1 - tc;
            int256 y1 = 2 * p1 - pc2;
            int256[6] memory num;
            int256[6] memory den;
            bool in0 = true;
            bool in1 = true;
            for (uint256 i; i < 6; ++i) {
                (int256 nt, int256 np, int256 c) = _con(i, r);
                int256 a0 = nt * x0 + np * y0;
                int256 a1 = nt * x1 + np * y1;
                num[i] = c - a0;
                den[i] = a1 - a0;
                bool o0 = a0 > c;
                bool o1 = a1 > c;
                if (o0 && o1) return false;
                if (o0) in0 = false;
                if (o1) in1 = false;
            }
            if (in0 || in1) return true;
            int256 loN = 0;
            int256 loD = 1;
            int256 hiN = 1;
            int256 hiD = 1;
            for (uint256 i; i < 6; ++i) {
                int256 n = num[i];
                int256 d = den[i];
                if (d == 0) {
                    if (n < 0) return false;
                } else if (d > 0) {
                    if (n * hiD < hiN * d) { hiN = n; hiD = d; }
                } else if (-n * loD > loN * -d) {
                    loN = -n;
                    loD = -d;
                }
            }
            return loN * hiD <= hiN * loD;
        }
    }

    /// band_range: bands of column k whose hex can contain a price in [pmin, pmax].
    function bandRange(uint256 k, int256 pmin, int256 pmax, int256 row) internal pure returns (int256, int256) {
        if (k % 2 == 0) return (ceilDiv(pmin, row) - 1, floorDiv(pmax, row));
        return (ceilDiv(2 * pmin - 3 * row, 2 * row), floorDiv(2 * pmax - row, 2 * row));
    }
}
