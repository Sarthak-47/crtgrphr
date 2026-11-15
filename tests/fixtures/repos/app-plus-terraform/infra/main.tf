resource "aws_db_instance" "main" {
  identifier = "shop-db"
  engine     = "postgres"
}
