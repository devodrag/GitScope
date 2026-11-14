use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use super::write_export;
use crate::error::{Error, Result};

fn entry(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|e| Error::detail("system", e))?
        .join("autostart")
        .join("app.gitscope.desktop.desktop"))
}

pub fn enabled(app: &AppHandle) -> Result<bool> {
    entry(app)?
        .try_exists()
        .map_err(|e| Error::detail("system", e))
}

pub fn set(app: &AppHandle, enabled: bool) -> Result<()> {
    let path = entry(app)?;
    let system = |error: std::io::Error| Error::detail("system", error);
    if !enabled {
        return match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(system(error)),
        };
    }
    if cfg!(debug_assertions) {
        return Err(Error::new("autostart_build"));
    }
    let binary = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)
        .map_err(system)?;
    let binary = binary
        .to_str()
        .filter(|path| !path.contains(['\n', '\r']))
        .ok_or_else(|| Error::new("system"))?;
    // Escape both Desktop Entry value parsing and Exec argument parsing.
    let mut escaped = String::with_capacity(binary.len());
    for character in binary.chars() {
        match character {
            '\\' => escaped.push_str(r"\\\\"),
            '"' | '`' | '$' => {
                escaped.push_str(r"\\");
                escaped.push(character);
            }
            '%' => escaped.push_str("%%"),
            _ => escaped.push(character),
        }
    }
    let contents = format!(
        "[Desktop Entry]\nType=Application\nName=GitScope\nExec=\"{escaped}\"\nIcon=gitscope\nTerminal=false\n"
    );
    let parent = path.parent().ok_or_else(|| Error::new("system"))?;
    fs::create_dir_all(parent).map_err(system)?;
    write_export(&path, contents.as_bytes())
}
