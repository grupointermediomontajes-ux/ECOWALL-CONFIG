// En Windows, no abrir la ventana de consola en la versión final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const PRICES_FILE: &str = "precios.xlsx";

// ------------------------------------------------------------ configuración
// Se guarda por usuario y equipo (carpeta de configuración de la app), no en el servidor.

#[derive(Serialize, Deserialize, Default)]
struct Config {
    projects_dir: Option<String>,
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let path = config_file(app)?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("No se pudo guardar la configuración: {}", e))
}

/// Carpeta de proyectos elegida por el usuario. Nunca se crea automáticamente.
fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let saved = read_config(app)
        .projects_dir
        .ok_or("No hay ninguna carpeta de proyectos seleccionada.")?;
    let dir = PathBuf::from(saved);
    if !dir.is_dir() {
        return Err(format!(
            "La carpeta de proyectos no está disponible: {}",
            dir.display()
        ));
    }
    Ok(dir)
}

/// Busca precios.xlsx dentro de la carpeta (sin distinguir mayúsculas/minúsculas).
fn find_prices(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name == PRICES_FILE && entry.path().is_file() {
            Some(entry.path())
        } else {
            None
        }
    })
}

// ------------------------------------------------------------ arranque

#[derive(Serialize)]
struct SetupStatus {
    state: String, // ok | no_folder | folder_unreachable | no_prices
    path: Option<String>,
}

/// Comprueba si hay carpeta guardada, si se puede acceder a ella y si contiene precios.xlsx.
/// (async: si el servidor no responde, no se bloquea la ventana)
#[tauri::command]
async fn check_setup(app: AppHandle) -> SetupStatus {
    match read_config(&app).projects_dir {
        None => SetupStatus {
            state: "no_folder".into(),
            path: None,
        },
        Some(p) => {
            let dir = PathBuf::from(&p);
            let state = if !dir.is_dir() {
                "folder_unreachable"
            } else if find_prices(&dir).is_none() {
                "no_prices"
            } else {
                "ok"
            };
            SetupStatus {
                state: state.into(),
                path: Some(p),
            }
        }
    }
}

/// Abre el selector de carpetas del sistema y guarda la elegida.
#[tauri::command]
async fn choose_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Selecciona la carpeta de proyectos (debe contener precios.xlsx)")
        .blocking_pick_folder();
    match picked {
        None => Ok(None),
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            let text = path.display().to_string();
            write_config(
                &app,
                &Config {
                    projects_dir: Some(text.clone()),
                },
            )?;
            Ok(Some(text))
        }
    }
}

/// Vuelve a usar una carpeta ya conocida (lista de carpetas recientes) sin abrir el selector.
#[tauri::command]
async fn use_folder(app: AppHandle, path: String) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("La carpeta no está disponible: {}", dir.display()));
    }
    write_config(
        &app,
        &Config {
            projects_dir: Some(path.clone()),
        },
    )?;
    Ok(path)
}

/// Contenido de precios.xlsx de la carpeta de proyectos.
#[tauri::command]
async fn load_prices(app: AppHandle) -> Result<Vec<u8>, String> {
    let dir = projects_dir(&app)?;
    let file = find_prices(&dir)
        .ok_or_else(|| format!("No se encuentra {} en {}", PRICES_FILE, dir.display()))?;
    fs::read(&file).map_err(|e| format!("No se pudo leer {}: {}", file.display(), e))
}

// ------------------------------------------------------------ proyectos

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim_end_matches(|c: char| c == '.' || c == ' ');
    let short: String = cleaned.chars().take(100).collect();
    if short.is_empty() {
        "proyecto".to_string()
    } else {
        short
    }
}

/// Extensión de los archivos de proyecto (el contenido sigue siendo texto JSON).
const PROJECT_EXT: &str = "ecowall";

fn project_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(projects_dir(app)?.join(format!("{}.{}", safe_name(name), PROJECT_EXT)))
}

#[derive(Serialize)]
struct ProjectFile {
    name: String,
    json: String,
}

/// Todos los proyectos (.ecowall) de la carpeta, para que aparezcan en todos los equipos.
#[tauri::command]
async fn list_projects(app: AppHandle) -> Result<Vec<ProjectFile>, String> {
    let dir = projects_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let is_project = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == PROJECT_EXT)
            .unwrap_or(false);
        if !is_project || !path.is_file() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.len() > 20_000_000 {
                continue;
            }
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                out.push(ProjectFile { name, json: text });
            }
        }
    }
    Ok(out)
}

/// Escritura segura en la carpeta del servidor: se escribe un temporal y se renombra encima del
/// original, así un corte de red a mitad no deja el proyecto dañado. La versión anterior se
/// conserva como «NOMBRE.ecowall.bak» (la lista de proyectos solo lee los «.ecowall»).
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{}.tmp", file_name));
    let written = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(format!("No se pudo guardar {}: {}", path.display(), e));
    }
    if path.exists() {
        let _ = fs::copy(path, path.with_file_name(format!("{}.bak", file_name)));
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("No se pudo guardar {}: {}", path.display(), e)
    })
}

#[tauri::command]
async fn save_project(app: AppHandle, name: String, json: String) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("Datos del proyecto no válidos: {}", e))?;
    let path = project_file(&app, &name)?;
    write_atomic(&path, &json)?;
    Ok(path.display().to_string())
}

#[tauri::command]
async fn load_project(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = project_file(&app, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("No se pudo leer {}: {}", path.display(), e))
}

#[tauri::command]
async fn delete_project(app: AppHandle, name: String) -> Result<(), String> {
    let path = project_file(&app, &name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Guarda el modelo 3D (OBJ): abre el cuadro «Guardar como» del sistema para elegir dónde.
/// Devuelve la ruta guardada, o None si se cancela.
#[tauri::command]
async fn save_export_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Guardar modelo 3D")
        .set_file_name(default_name)
        .add_filter("Modelo 3D (OBJ)", &["obj"])
        .blocking_save_file();
    match picked {
        None => Ok(None),
        Some(fp) => {
            let mut path = fp.into_path().map_err(|e| e.to_string())?;
            if path.extension().is_none() {
                path.set_extension("obj");
            }
            fs::write(&path, content)
                .map_err(|e| format!("No se pudo guardar {}: {}", path.display(), e))?;
            Ok(Some(path.display().to_string()))
        }
    }
}

/// Guarda un archivo de texto (p. ej. un proyecto exportado .ecowall) donde elija el usuario.
/// Devuelve la ruta guardada, o None si se cancela.
#[tauri::command]
async fn save_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
    filter_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Guardar archivo")
        .set_file_name(default_name)
        .add_filter(filter_name, &[extension.as_str()])
        .blocking_save_file();
    match picked {
        None => Ok(None),
        Some(fp) => {
            let mut path = fp.into_path().map_err(|e| e.to_string())?;
            if path.extension().is_none() {
                path.set_extension(&extension);
            }
            fs::write(&path, content)
                .map_err(|e| format!("No se pudo guardar {}: {}", path.display(), e))?;
            Ok(Some(path.display().to_string()))
        }
    }
}

/// Guarda un archivo binario (p. ej. el plano en PNG) donde elija el usuario.
/// Devuelve la ruta guardada, o None si se cancela.
#[tauri::command]
async fn save_bytes_file(
    app: AppHandle,
    default_name: String,
    content: Vec<u8>,
    filter_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Guardar archivo")
        .set_file_name(default_name)
        .add_filter(filter_name, &[extension.as_str()])
        .blocking_save_file();
    match picked {
        None => Ok(None),
        Some(fp) => {
            let mut path = fp.into_path().map_err(|e| e.to_string())?;
            if path.extension().is_none() {
                path.set_extension(&extension);
            }
            fs::write(&path, content)
                .map_err(|e| format!("No se pudo guardar {}: {}", path.display(), e))?;
            Ok(Some(path.display().to_string()))
        }
    }
}

/// Imprimir: en macOS el window.print() de JavaScript no hace nada dentro de Tauri.
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_setup,
            choose_folder,
            use_folder,
            load_prices,
            list_projects,
            save_project,
            load_project,
            delete_project,
            save_export_file,
            save_text_file,
            save_bytes_file,
            print_page
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar ECOWALL");
}
