# User

## 基础

| 字段         | 类型          | 描述         |
| ------------ | ------------- | ------------ |
| username     | String        | 用户名       |
| password     | String        | 密码         |
| email        | String        | 电子邮件     |
| role         | String        | 身份         |
| fullname     | String        | 真实名称全名 |
| nickname     | String        | 昵称         |
| discardname  | String        | 曾用名       |
| introduction | String        | 个人简介     |
| avatar       | String        | 头像         |
| location     | String        | 所在地       |
| createTime   | Number / Date | 账户创建时间 |

## 扩展


| 字段           | 类型   | 描述                                 |
| -------------- | ------ | ------------------------------------ |
| lastPostTime   | Number | 上次发帖时间                         |
| lastActivity   | Number | 上次活跃时间                         |
| visitCount     | Number | 网站访问天数                         |
| readDuration   | Number | 阅读总时长                           |
| topicReadCount | Number | 话题阅读量（需要观看话题一定时间）   |
| replyReadCount | Number | 回复阅读量（在当前回复停留一定时长） |
|                |        |                                      |

## 扩展

| 字段     | 类型  | 描述           |
| -------- | ----- | -------------- |
| replies  | Array | 回复           |
| themes   | Array | 创建的主题     |
| supports | Array | 点赞他人的回复 |

## 基于扩展的延伸

