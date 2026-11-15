resource "aws_dynamodb_table" "orders" {
  name     = "orders"
  hash_key = "id"
}

resource "aws_sqs_queue" "events" {
  name = "order-events"
}

resource "aws_lambda_function" "mailer" {
  function_name = "mailer"
  role          = aws_iam_role.lambda.arn
}

resource "aws_lambda_event_source_mapping" "mailer" {
  event_source_arn = aws_sqs_queue.events.arn
  function_name    = aws_lambda_function.mailer.arn
}

resource "aws_s3_bucket" "receipts" {
  bucket = "acme-receipts"
}

module "network" {
  source = "./modules/network"
}

data "aws_caller_identity" "me" {}
