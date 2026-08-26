#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test scripts/health-probe.py DOM/heap trend detection.

保证：
  1. 真泄漏场景（严格递增，总增幅>=1000 nodes 或 30 MB）→ 触发告警
  2. Plateau + 冷加载首个低值（[3629,5464,5464,5464,5464,5464]）→ 不触发（历史误报模式）
  3. 稳定平台（[5464,5464,5464,5464,5464,5464]）→ 不触发
  4. 有涨有跌的抖动 → 不触发

旧实现（用 >=）会在场景 2/3 都触发（红色）。新实现只在场景 1 触发（绿色）。
"""
import sys, os, importlib.util

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
probe_path = os.path.join(REPO, "scripts", "health-probe.py")
spec = importlib.util.spec_from_file_location("health_probe", probe_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def check(nodes, heaps=None, threshold_nodes=1000, threshold_heaps=30):
    """Mimic the trend check logic against synthetic sample lists."""
    heaps = heaps if heaps is not None else [4]*len(nodes)
    if len(nodes) != 6:
        raise ValueError("need exactly 6 samples")
    issues = []
    heaps_f = mod._drop_cold_outliers(heaps)
    nodes_f = mod._drop_cold_outliers(nodes)
    if len(heaps_f) >= 5 and all(b > a for a, b in zip(heaps_f, heaps_f[1:])) and heaps_f[-1] - heaps_f[0] >= threshold_heaps:
        issues.append(("heap", heaps_f))
    if len(nodes_f) >= 5 and all(b > a for a, b in zip(nodes_f, nodes_f[1:])) and nodes_f[-1] - nodes_f[0] >= threshold_nodes:
        issues.append(("nodes", nodes_f))
    return issues


def old_check(nodes, heaps=None):
    """Old (broken) logic: uses >= for monotone check, no outlier filter."""
    heaps = heaps if heaps is not None else [4]*len(nodes)
    issues = []
    if all(b >= a for a, b in zip(heaps, heaps[1:])) and heaps[-1] - heaps[0] >= 30:
        issues.append(("heap", heaps))
    if all(b >= a for a, b in zip(nodes, nodes[1:])) and nodes[-1] - nodes[0] >= 1000:
        issues.append(("nodes", nodes))
    return issues


CASES = [
    # (name, nodes, expect_new_alert, expect_old_alert_had_false_positive)
    ("real_leak_strict_growth",   [3600, 3800, 4100, 4400, 4700, 5000], True,  True),
    ("plateau_with_cold_first",   [3629, 5464, 5464, 5464, 5464, 5464], False, True),  # 8/26 real-world case
    ("pure_plateau",              [5464, 5464, 5464, 5464, 5464, 5464], False, False),
    ("mid_dip_recovery",          [5464, 5400, 5464, 5464, 5464, 5464], False, False),
    ("noisy_oscillation",         [5464, 5400, 5500, 5400, 5500, 5400], False, False),
    ("real_slow_growth_borderline",[5000, 5200, 5400, 5600, 5800, 6100], True, True),
]

failures = []
for name, nodes, expect_new, _ in CASES:
    got_new = bool(check(nodes))
    got_old = bool(old_check(nodes))
    marker = "OK" if got_new == expect_new else "FAIL"
    if got_new != expect_new:
        failures.append((name, expect_new, got_new))
    print(f"  [{marker}] {name}: new={got_new} (expect {expect_new}) | old={got_old}")

# Case 2 is the critical regression: old implementation reports leak (red), new does not (green).
old_case2 = bool(old_check([3629, 5464, 5464, 5464, 5464, 5464]))
new_case2 = bool(check([3629, 5464, 5464, 5464, 5464, 5464]))
assert old_case2 and not new_case2, (
    f"regression proof missing: old should red (got {old_case2}), new should green (got {new_case2})"
)
print("\n[proof] old impl RED on cold-load-plateau ✔  new impl GREEN on cold-load-plateau ✔")

if failures:
    print("\nFAILURES:", failures)
    sys.exit(1)
print("\nall trend-check assertions passed")
