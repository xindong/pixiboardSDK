use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
struct State {
    leases: Mutex<HashMap<String, String>>,
    documents: Mutex<HashMap<String, Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    board_id: String,
    project_root: String,
    lease_id: String,
    request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeResponse {
    adapter: &'static str,
    capabilities: [&'static str; 4],
}

fn check_lease(state: &State, context: &Context) -> Result<(), String> {
    let leases = state
        .leases
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    match leases.get(&context.board_id) {
        Some(lease) if lease == &context.lease_id => Ok(()),
        _ => Err(serde_json::json!({
            "code": "STALE_LEASE",
            "message": "project lease is no longer active"
        })
        .to_string()),
    }
}

#[tauri::command]
fn pixiboard_sdk_smoke_ping() -> SmokeResponse {
    SmokeResponse {
        adapter: "tauri",
        capabilities: [
            "document.persistence",
            "assets.metadata",
            "assets.resolve",
            "derivatives",
        ],
    }
}

#[tauri::command]
fn pixiboard_sdk_project_acquire(
    state: tauri::State<'_, State>,
    board_id: String,
    project_root: String,
    lease_id: String,
) -> Result<(), String> {
    let mut leases = state
        .leases
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    if leases.contains_key(&board_id) {
        return Err(
            serde_json::json!({ "code": "CONFLICT", "message": "board already has a lease" })
                .to_string(),
        );
    }
    leases.insert(board_id, lease_id);
    state
        .documents
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .entry(project_root)
        .or_insert(Value::Null);
    Ok(())
}

#[tauri::command]
fn pixiboard_sdk_project_release(
    state: tauri::State<'_, State>,
    board_id: String,
    lease_id: String,
    project_root: String,
) -> Result<(), String> {
    let mut leases = state
        .leases
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    if leases.get(&board_id) != Some(&lease_id) {
        return Err(
            serde_json::json!({ "code": "STALE_LEASE", "message": "lease already released" })
                .to_string(),
        );
    }
    leases.remove(&board_id);
    let _ = project_root;
    Ok(())
}

#[tauri::command]
fn pixiboard_sdk_operation_cancel(context: Context) -> Result<(), String> {
    let _ = context.request_id;
    Ok(())
}

#[tauri::command]
fn pixiboard_sdk_document_load(
    state: tauri::State<'_, State>,
    context: Context,
) -> Result<Option<Value>, String> {
    check_lease(&state, &context)?;
    let documents = state
        .documents
        .lock()
        .map_err(|_| "state poisoned".to_string())?;
    Ok(documents
        .get(&context.project_root)
        .cloned()
        .filter(|value| !value.is_null()))
}

#[tauri::command]
fn pixiboard_sdk_document_save(
    state: tauri::State<'_, State>,
    context: Context,
    document: Value,
) -> Result<(), String> {
    check_lease(&state, &context)?;
    state
        .documents
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .insert(context.project_root, document);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            pixiboard_sdk_smoke_ping,
            pixiboard_sdk_project_acquire,
            pixiboard_sdk_project_release,
            pixiboard_sdk_operation_cancel,
            pixiboard_sdk_document_load,
            pixiboard_sdk_document_save,
        ])
        .setup(|app| {
            if std::env::args().any(|arg| arg == "--smoke") {
                app.handle().exit(0);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PixiBoardJS Tauri smoke");
}
