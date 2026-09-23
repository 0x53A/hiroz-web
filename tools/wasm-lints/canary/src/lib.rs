// This fixture must FAIL the boundary lint, including through this alias.
pub async fn forbidden() {
    use tokio::time::sleep as innocent_name;
    innocent_name(std::time::Duration::from_millis(1)).await;
}
