# Browser robot interface definitions

These definitions are inputs to hiroz-codegen, not manually constructed wire
messages. `build.rs` resolves their standard dependencies from the bundled
hiroz-codegen assets and generates CDR serialization plus ROS type hashes.
No local ROS installation is used by the browser build.

- `nav2_msgs/action/NavigateToPose.action`: copied from Navigation2's Jazzy
  branch at commit `f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501`:
  <https://github.com/ros-navigation/navigation2/blob/f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501/nav2_msgs/action/NavigateToPose.action>.
  Includes the NONE constant, error_code/error_msg result and all feedback
  fields. Nav2 interfaces can change between ROS releases; this is a Jazzy
  interface profile, not a promise of compatibility with every Nav2 version.
- `turtlesim_msgs/msg/Pose.msg` and `action/RotateAbsolute.action`: ROS
  `ros_tutorials` Lyrical turtlesim interfaces, verified against the official
  source definitions. The native UI fixture uses ROS 2 Lyrical and rmw_zenoh;
  this profile does not substitute for native Nav2 validation. Source:
  <https://github.com/ros/ros_tutorials/tree/lyrical/turtlesim_msgs>.
  Older ROS releases use a different package name and require a corresponding
  profile; selecting the same fields alone does not change the ROS type name.
