#!/usr/bin/env python3
"""Bounded real ROS 2 action peer for the browser integration suite."""
import sys
import threading
import time
import rclpy
from rclpy.action import ActionClient, ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from action_msgs.msg import GoalStatus, GoalStatusArray
from action_msgs.srv import CancelGoal
from rclpy.qos import qos_profile_action_status_default
from example_interfaces.action import Fibonacci


def sequence(order):
    values = [0, 1]
    for _ in range(2, order + 1):
        values.append(values[-1] + values[-2])
    return values


def wait(future, seconds=15):
    deadline = time.monotonic() + seconds
    while not future.done() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert future.done(), 'ROS future timed out'
    return future.result()


def run_client(node):
    client = ActionClient(node, Fibonacci, 'wasm_fibonacci', callback_group=ReentrantCallbackGroup())
    assert client.wait_for_server(timeout_sec=20), 'browser action server not discovered'
    feedback = []
    statuses = {}
    def on_status(message):
        for status in message.status_list:
            statuses.setdefault(tuple(status.goal_info.goal_id.uuid), []).append(status)
    status_sub = node.create_subscription(GoalStatusArray, 'wasm_fibonacci/_action/status', on_status, qos_profile_action_status_default)
    def goal(order):
        return wait(client.send_goal_async(Fibonacci.Goal(order=order), feedback_callback=lambda msg: feedback.append(msg.feedback.sequence)))
    rejected = goal(-1)
    assert not rejected.accepted, 'negative goal was not rejected'
    print('PASS: Python client rejection', flush=True)
    a, b = goal(5), goal(6)
    assert a.accepted and b.accepted
    ar, br = wait(a.get_result_async()), wait(b.get_result_async())
    assert ar.status == br.status == GoalStatus.STATUS_SUCCEEDED
    assert list(ar.result.sequence) == sequence(5) and list(br.result.sequence) == sequence(6)
    assert feedback, 'no browser feedback'
    print('PASS: Python client concurrent success and feedback', flush=True)
    aborted = goal(13)
    result = wait(aborted.get_result_async())
    assert result.status == GoalStatus.STATUS_ABORTED
    print('PASS: Python client aborted status', flush=True)
    canceled = goal(99)
    pending_result = canceled.get_result_async()
    time.sleep(0.05)
    response = wait(canceled.cancel_goal_async())
    assert response.return_code == 0 and len(response.goals_canceling) == 1
    assert response.goals_canceling[0].goal_id == canceled.goal_id
    result = wait(pending_result)
    assert result.status == GoalStatus.STATUS_CANCELED
    print('PASS: Python client cancellation and terminal result', flush=True)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and not any(s.status == GoalStatus.STATUS_CANCELED for s in statuses.get(tuple(canceled.goal_id.uuid), [])):
        time.sleep(0.01)
    history = statuses.get(tuple(canceled.goal_id.uuid), [])
    # Status uses KeepLast(1): adjacent Canceling/Canceled snapshots may be
    # coalesced before this observer runs. Require correlated cancel acceptance
    # and terminal result/status, not receipt of every intermediate snapshot.
    assert any(s.status == GoalStatus.STATUS_CANCELED for s in history), 'missing Canceled status transition'
    assert all(s.goal_info.stamp == canceled.stamp for s in history), 'status stamp differs from accepted-goal stamp'
    print('PASS: Python terminal cancellation status preserves acceptance stamp', flush=True)
    original = goal(99)
    duplicate = wait(client.send_goal_async(Fibonacci.Goal(order=5), goal_uuid=original.goal_id))
    assert not duplicate.accepted, 'duplicate UUID was accepted'
    wait(original.cancel_goal_async())
    assert wait(original.get_result_async()).status == GoalStatus.STATUS_CANCELED
    print('PASS: Python duplicate goal UUID rejected without replacing original', flush=True)

    accepted = goal(77)
    response = wait(accepted.cancel_goal_async())
    assert response.return_code == 0
    assert wait(accepted.get_result_async()).status == GoalStatus.STATUS_CANCELED
    print('PASS: Python cancels accepted goal before execution starts', flush=True)

    slow, fast = goal(99), goal(5)
    slow_result = slow.get_result_async()
    fast_result = wait(fast.get_result_async())
    assert fast_result.status == GoalStatus.STATUS_SUCCEEDED
    assert not slow_result.done(), 'slow goal unexpectedly finished'
    wait(slow.cancel_goal_async())
    assert wait(slow_result).status == GoalStatus.STATUS_CANCELED
    print('PASS: Python concurrent result requests progress independently', flush=True)

    cancel_service = node.create_client(CancelGoal, 'wasm_fibonacci/_action/cancel_goal', callback_group=ReentrantCallbackGroup())
    assert cancel_service.wait_for_service(timeout_sec=5)
    a = goal(99)
    time.sleep(0.05)
    b = goal(99)
    request = CancelGoal.Request()
    request.goal_info.stamp = a.stamp
    response = wait(cancel_service.call_async(request))
    assert response.return_code == 0
    assert [list(info.goal_id.uuid) for info in response.goals_canceling] == [list(a.goal_id.uuid)]
    assert wait(a.get_result_async()).status == GoalStatus.STATUS_CANCELED
    wait(b.cancel_goal_async())
    assert wait(b.get_result_async()).status == GoalStatus.STATUS_CANCELED
    print('PASS: Python timestamp-only cancellation selects older goal', flush=True)

    a = goal(99)
    time.sleep(0.05)
    b = goal(99)
    time.sleep(0.05)
    c = goal(99)
    request = CancelGoal.Request()
    request.goal_info.goal_id = c.goal_id
    request.goal_info.stamp = a.stamp
    response = wait(cancel_service.call_async(request))
    assert response.return_code == 0
    assert {tuple(info.goal_id.uuid) for info in response.goals_canceling} == {tuple(a.goal_id.uuid), tuple(c.goal_id.uuid)}
    assert wait(a.get_result_async()).status == GoalStatus.STATUS_CANCELED
    assert wait(c.get_result_async()).status == GoalStatus.STATUS_CANCELED
    wait(b.cancel_goal_async())
    assert wait(b.get_result_async()).status == GoalStatus.STATUS_CANCELED
    print('PASS: Python UUID-or-timestamp cancellation selects both goals', flush=True)
    node.destroy_subscription(status_sub)
    node.destroy_client(cancel_service)
    client.destroy()
    print('Python action tests complete', flush=True)


def main():
    rclpy.init()
    node = Node('python_action_' + sys.argv[1])
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    spin = threading.Thread(target=executor.spin, daemon=True)
    spin.start()
    server = None
    try:
        if sys.argv[1] == 'client':
            run_client(node)
        else:
            def execute(handle):
                order = handle.request.order
                values = [0, 1]
                for i in range(2, (200 if order == 99 else order) + 1):
                    time.sleep(0.05)
                    if handle.is_cancel_requested:
                        handle.canceled()
                        return Fibonacci.Result(sequence=values)
                    values.append(values[-1] + values[-2] if i < 30 else 0)
                    handle.publish_feedback(Fibonacci.Feedback(sequence=values))
                    if order == 13:
                        handle.abort()
                        return Fibonacci.Result(sequence=[13])
                handle.succeed()
                return Fibonacci.Result(sequence=values)
            server = ActionServer(node, Fibonacci, 'python_fibonacci', execute,
                callback_group=ReentrantCallbackGroup(),
                goal_callback=lambda goal: GoalResponse.REJECT if goal.order < 0 else GoalResponse.ACCEPT,
                cancel_callback=lambda goal: CancelResponse.ACCEPT)
            print('Python action server ready', flush=True)
            # Container/test harness owns this process; still bound abandoned runs.
            time.sleep(600)
    finally:
        if server:
            server.destroy()
        executor.shutdown(timeout_sec=3)
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
