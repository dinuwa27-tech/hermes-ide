fn main() {
    build_pty_setup_helper();
    tauri_build::build()
}

fn build_pty_setup_helper() {
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let pty_setup_dir = manifest_dir.join("pty-setup");

        if !pty_setup_dir.join("Cargo.toml").exists() {
            return;
        }

        let out_dir = std::env::var("OUT_DIR").unwrap();
        let main_target_dir = std::path::Path::new(&out_dir)
            .ancestors()
            .find(|p| p.ends_with("target/debug") || p.ends_with("target/release"));

        let main_target_dir = match main_target_dir {
            Some(d) => d,
            None => return,
        };

        let profile = if main_target_dir.ends_with("release") {
            "release"
        } else {
            "dev"
        };

        let profile_dir = if profile == "release" {
            "release"
        } else {
            "debug"
        };

        let helper_target_dir = manifest_dir.join("target").join("pty-setup-build");
        let status = std::process::Command::new("cargo")
            .args([
                "build",
                "--manifest-path",
                pty_setup_dir.join("Cargo.toml").to_str().unwrap(),
                "--target-dir",
                helper_target_dir.to_str().unwrap(),
                &format!("--profile={}", profile),
            ])
            .status();

        match status {
            Ok(s) if s.success() => {
                let built = helper_target_dir.join(profile_dir).join("hermes-pty-setup");
                let dest = main_target_dir.join("hermes-pty-setup");
                if built.exists() {
                    if let Err(e) = std::fs::copy(&built, &dest) {
                        println!("cargo:warning=Failed to copy hermes-pty-setup: {}", e);
                    }
                }
            }
            Ok(s) => {
                println!(
                    "cargo:warning=Failed to build hermes-pty-setup (exit code: {:?})",
                    s.code()
                );
            }
            Err(e) => {
                println!("cargo:warning=Failed to build hermes-pty-setup: {}", e);
            }
        }

        println!("cargo:rerun-if-changed=pty-setup/src/main.rs");
        println!("cargo:rerun-if-changed=pty-setup/Cargo.toml");
    }
}
