pluginManagement { includeBuild("build-logic") }
rootProject.name = "deep"
include(":app")
include(":core:data")
include(":core:data-test")
include(":core:testing")
include(":feature:foryou:api")
include(":feature:foryou:impl")
include(":feature:topic:api")
include(":feature:topic:impl")
include(":benchmarks")
