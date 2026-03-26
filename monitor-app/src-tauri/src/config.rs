use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const EXEC_PATH: &str = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub project_dir: PathBuf,
    pub git_project_dir: PathBuf,
    pub git_project_label: String,
    pub env_file: PathBuf,
    pub container_name: String,
    pub database_url: Option<String>,
}

impl AppConfig {
    pub fn load() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let default_project_dir = home.join("Downloads/projects/transcode-worker");

        // Read config.json from the app's config directory
        let cfg = read_config_json();

        // Resolve project_dir
        let project_dir = cfg
            .get("projectDir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or(default_project_dir);

        // Resolve git_project_dir
        let git_project_dir = resolve_git_project_dir(&cfg, &project_dir, &home);

        let git_project_label = git_project_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Redprint".to_string());

        let env_file = project_dir.join(".env.worker");

        // Parse .env.worker for DATABASE_URL
        let env_vars = parse_env_file(&env_file);
        let database_url = env_vars.get("DATABASE_URL").cloned();

        AppConfig {
            project_dir,
            git_project_dir,
            git_project_label,
            env_file,
            container_name: "redprint-worker".to_string(),
            database_url,
        }
    }
}

/// Read config.json from the platform-specific app config directory.
/// Returns an empty JSON object on any failure.
fn read_config_json() -> serde_json::Value {
    // On macOS: ~/Library/Application Support/com.transcode-monitor/config.json
    let config_dir = dirs::config_dir()
        .map(|d| d.join("com.transcode-monitor"))
        .unwrap_or_else(|| PathBuf::from("/tmp"));

    let cfg_path = config_dir.join("config.json");

    match fs::read_to_string(&cfg_path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

/// Resolve the git project directory using the monitor app's compatibility lookup:
/// 1. Check config.json for gitProjectDir
/// 2. Check for sibling Redprint/.git directory
/// 3. Fallback to ~/Downloads/projects/Redprint
fn resolve_git_project_dir(
    cfg: &serde_json::Value,
    project_dir: &Path,
    home: &Path,
) -> PathBuf {
    // 1. Explicit config
    if let Some(dir) = cfg.get("gitProjectDir").and_then(|v| v.as_str()) {
        return PathBuf::from(dir);
    }

    // 2. Sibling Redprint directory (parent of project_dir + "Redprint")
    if let Some(parent) = project_dir.parent() {
        let sibling = parent.join("Redprint");
        if sibling.join(".git").exists() {
            return sibling;
        }
    }

    // 3. Fallback
    home.join("Downloads/projects/Redprint")
}

/// Parse a .env-style file into a HashMap.
/// Skips empty lines and comments (lines starting with #).
/// Handles KEY=VALUE format where KEY starts with a letter or underscore.
pub fn parse_env_file(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();

    let contents = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return map,
    };

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(eq_pos) = trimmed.find('=') {
            let key = &trimmed[..eq_pos];
            let value = trimmed[eq_pos + 1..].trim();
            // Validate key: must match [A-Z_][A-Z0-9_]*
            if !key.is_empty()
                && key
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_uppercase() || c == '_')
                    .unwrap_or(false)
                && key
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                map.insert(key.to_string(), value.to_string());
            }
        }
    }

    map
}
