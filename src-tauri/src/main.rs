fn main() {
    #[cfg(feature = "desktop")]
    gitscope::desktop::run();
}
