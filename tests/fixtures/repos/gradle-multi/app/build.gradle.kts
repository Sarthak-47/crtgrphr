plugins { id("io.ktor.plugin") }
dependencies {
    implementation("io.ktor:ktor-server-core-jvm:2.3.0")
    implementation(project(":domain"))
    implementation(projects.adapters.billing)
    runtimeOnly("org.postgresql:postgresql:42.7.0")
}
