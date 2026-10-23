"""Concurrency and bounds of the service-level memo."""

import threading
import time

from app.services import BoundedMemo


def test_concurrent_requests_for_one_key_compute_once():
    memo = BoundedMemo(4)
    calls = []
    barrier = threading.Barrier(8)

    def compute():
        calls.append(1)
        time.sleep(0.05)
        return "value"

    def worker(results):
        barrier.wait()
        results.append(memo.get("gate-09:50", compute))

    results: list[str] = []
    threads = [threading.Thread(target=worker, args=(results,)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == ["value"] * 8
    assert len(calls) == 1


def test_memo_evicts_least_recently_used_keys():
    memo = BoundedMemo(2)
    memo.get("a", lambda: 1)
    memo.get("b", lambda: 2)
    memo.get("a", lambda: 99)  # refreshes "a"
    memo.get("c", lambda: 3)  # evicts "b"
    assert len(memo) == 2
    assert memo.get("a", lambda: 100) == 1
    assert memo.get("b", lambda: 20) == 20  # recomputed after eviction
