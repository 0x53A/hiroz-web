use std::{collections::HashSet, env, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rustc-check-cfg=cfg(feature, values(\"python_registry\"))");
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let local = root.join("tests/interfaces");
    let packages = [local.join("nav2_msgs"), local.join("turtlesim_msgs")];
    let dependencies = hiroz_codegen::discover_bundled_packages(false)?;
    let config = hiroz_codegen::GeneratorConfig {
        generate_cdr: true,
        generate_protobuf: false,
        generate_type_info: true,
        is_humble: false,
        output_dir: PathBuf::from(env::var("OUT_DIR")?),
        external_crate: Some("hiroz_msgs".into()),
        local_packages: HashSet::from(["nav2_msgs".into(), "turtlesim_msgs".into()]),
        json_out: None,
    };
    hiroz_codegen::MessageGenerator::new(config).generate_from_msg_files_with_deps(
        &packages
            .iter()
            .map(|path| path.as_path())
            .collect::<Vec<_>>(),
        &dependencies
            .iter()
            .map(|path| path.as_path())
            .collect::<Vec<_>>(),
    )?;
    println!("cargo:rerun-if-changed=tests/interfaces");
    println!("cargo:rerun-if-changed=build.rs");
    Ok(())
}
